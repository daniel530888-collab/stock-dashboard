/* 資料新鮮度徽章（M439，2026-09-26）
 *
 * ## 為什麼存在
 *
 * `docs/` 底下 60 個 json 分兩種，而**網站上分不出來**：
 *
 *     14 個  每日 pipeline 產的     舊 = BUG
 *     46 個  一次性研究輸出         舊 = 正常
 *
 * 實測（2026-09-26）：首頁最舊 2 天（正常），但
 * `review.html` 讀 9 份、最舊 **30 天**，`research.html` 16 天、
 * `diagnostics` 16 天、`exit_lab` 15 天、`hypothesis_lab` 11 天 ——
 * 而頁面上**完全看不出來**，一份 30 天前的快照讀起來像今天的。
 *
 * **M425 已經被這件事咬過一次**：四面全景圖停更 13 天、三個欄位翻面
 * 沒跟上，而頁面照樣顯示得很完整。跟 2026-09-25/26 抓到的七個缺陷
 * 同一個形狀：**過期跟最新，在畫面上長得一樣。**
 *
 * ## 三條規則
 *
 *   1. 有日期就顯示日期與「N 天前」
 *   2. 超過 STALE_DAYS 變色並加一句「這是 N 天前的快照」
 *   3. **沒有日期一律顯示「資料日期不明」** —— 不准靜默當成今天。
 *      「不明」比「看起來像今天」誠實。實測有 16 份 json 沒有任何日期欄位。
 */
(function (w) {
  'use strict';

  var STALE_DAYS = 7;

  /* 各支腳本用的欄位名不一致（33 個 last_updated、1 個 generated、
     1 個 date、9 個只有 panel_vintage）。panel_vintage 放最後：
     它是**面板**的日期，不是這份輸出產生的日期，只能當退路。 */
  var KEYS = ['as_of', 'last_updated', 'generated', 'date', 'panel_vintage'];

  function parse(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    // 20260924 這種純數字格式
    var m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) s = m[1] + '-' + m[2] + '-' + m[3];
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** 從一份 json（或多份）取出最舊的日期。回 null 代表沒有任何日期。 */
  function asOf(data) {
    var list = Array.isArray(data) ? data : [data];
    var oldest = null, sawAny = false;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || typeof o !== 'object') continue;
      for (var k = 0; k < KEYS.length; k++) {
        if (!(KEYS[k] in o)) continue;
        var d = parse(o[KEYS[k]]);
        if (d) { sawAny = true; if (!oldest || d < oldest) oldest = d; }
        break;
      }
    }
    return sawAny ? oldest : null;
  }

  function days(d) {
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  /**
   * 把徽章畫進 elId。data 可以是一份 json 或一個陣列（取最舊的那份）。
   * label 用來說「本頁最舊資料」還是「資料日期」。
   */
  function render(elId, data, label) {
    var el = document.getElementById(elId);
    if (!el) return;
    var d = asOf(data);
    var base = 'display:inline-block;font-size:12px;letter-spacing:.03em;'
             + 'padding:3px 9px;border-radius:11px;border:1px solid;';
    if (!d) {
      // ★ 規則 3：不明就講不明。
      el.innerHTML = '<span style="' + base
        + 'color:#C9A227;border-color:rgba(201,162,39,.45);'
        + 'background:rgba(201,162,39,.08)" '
        + 'title="這份資料沒有寫入產生日期，所以無法判斷新不新。'
        + '不顯示日期不代表它是今天的。">資料日期不明</span>';
      return;
    }
    var n = days(d);
    var iso = d.toISOString().slice(0, 10);
    var stale = n > STALE_DAYS;
    var col = stale ? '#C9A227' : 'var(--text-muted, #8a8a8a)';
    var bg = stale ? 'rgba(201,162,39,.08)' : 'transparent';
    var txt = (label || '資料日期') + ' ' + iso
            + (n <= 0 ? '（今天）' : '（' + n + ' 天前）');
    el.innerHTML = '<span style="' + base + 'color:' + col
      + ';border-color:' + (stale ? 'rgba(201,162,39,.45)'
                                  : 'rgba(255,255,255,.14)')
      + ';background:' + bg + '">' + txt + '</span>'
      + (stale ? '<div style="margin-top:6px;font-size:12px;color:#C9A227">'
               + '這是 ' + n + ' 天前的快照，不是今天的狀態。</div>' : '');
  }

  /* ── 自動掛上：攔 fetch，看到 .json 就把它納入計算 ──────────────
   *
   * 為什麼不逐頁改：五個頁面的載入寫法各不相同，而 `review.html`
   * 一頁就讀 **9 份** json —— 逐頁改要動十幾個呼叫點，而且以後每加
   * 一份資料就要記得再加一次。**靠記得的做法遲早會漏**（這一整個
   * 專案今天抓到的七個缺陷都是這樣來的）。
   *
   * 攔 fetch 的代價：每份 json 多一次 clone + parse。這些頁面本來就
   * 只載入個位數檔案，可以接受。
   *
   * 只有放了 `#freshness-badge` 的頁面會顯示 —— 首頁沒有那個 div，
   * 所以完全不受影響。
   */
  var seen = [], timer = null, LABEL = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    // 等 300ms，讓同一頁的多份 json 都到齊再畫一次（取最舊的那份）
    timer = setTimeout(function () {
      render('freshness-badge', seen,
             LABEL || (seen.length > 1 ? '本頁最舊資料' : '資料日期'));
    }, 300);
  }

  if (typeof w.fetch === 'function') {
    var orig = w.fetch.bind(w);
    w.fetch = function (input, init) {
      var url = typeof input === 'string' ? input
              : (input && input.url) || '';
      var p = orig(input, init);
      if (!/\.json(\?|$)/.test(url)) return p;
      return p.then(function (res) {
        if (!document.getElementById('freshness-badge')) return res;
        try {
          res.clone().json().then(function (d) {
            if (d && typeof d === 'object') { seen.push(d); schedule(); }
          }, function () { /* 不是 JSON 就算了，不該擋住頁面 */ });
        } catch (e) { /* clone 失敗也不該擋住頁面 */ }
        return res;
      });
    };
  }

  w.Freshness = {
    asOf: asOf, render: render, STALE_DAYS: STALE_DAYS,
    setLabel: function (s) { LABEL = s; schedule(); },
    _seen: seen,
  };
})(window);
