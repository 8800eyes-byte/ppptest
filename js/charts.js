/* 의존성 없는 SVG 차트. 모든 차트는 hover 툴팁과 '표로 보기'를 함께 제공한다. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  /* 컨테이너 실제 폭으로 그려 글자가 축소되지 않게 한다(숨겨진 탭이면 기본값) */
  function widthOf(container, d) {
    var w = container.clientWidth;
    return w > 0 ? Math.max(300, Math.round(w)) : d;
  }

  var tip;
  function showTip(evt, html) {
    tip = tip || document.getElementById('tooltip');
    tip.innerHTML = html;
    tip.hidden = false;
    var x = evt.clientX + 14, y = evt.clientY + 14;
    var r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function bindHover(node, html) {
    node.addEventListener('mousemove', function (e) { showTip(e, html); });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('focus', function () {
      var r = node.getBoundingClientRect();
      showTip({ clientX: r.left + r.width / 2, clientY: r.top }, html);
    });
    node.addEventListener('blur', hideTip);
  }

  function tableHtml(headers, rows) {
    return '<table class="data-table compact"><thead><tr>' + headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* 가로 막대 — 단일 계열. items: [{label, value, note?}] */
  function hbar(container, items, opts) {
    opts = opts || {};
    var unit = opts.unit || '';
    var rowH = 30, labelW = opts.labelW || 84, valueW = 48, W = widthOf(container, 520);
    var H = items.length * rowH + 8;
    var max = niceMax(Math.max.apply(null, items.map(function (d) { return d.value; }).concat([1])));
    var plotW = W - labelW - valueW;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.title || '막대 차트' });

    [0.5, 1].forEach(function (f) {
      var x = labelW + plotW * f;
      svg.appendChild(el('line', { x1: x, x2: x, y1: 0, y2: H - 4, class: 'grid' }));
    });

    items.forEach(function (d, i) {
      var y = i * rowH + 6;
      var w = Math.max(d.value > 0 ? 4 : 0, plotW * d.value / max);
      var lab = el('text', { x: labelW - 10, y: y + 13, class: 'axis-label', 'text-anchor': 'end' });
      lab.textContent = d.label;
      svg.appendChild(lab);
      if (w > 0) {
        var path = el('path', {
          d: 'M' + labelW + ',' + y + 'h' + (w - 4) + 'a4,4 0 0 1 4,4v10a4,4 0 0 1 -4,4h-' + (w - 4) + 'z',
          class: 'bar' + (d.highlight ? ' bar-strong' : '')
        });
        svg.appendChild(path);
      }
      var val = el('text', { x: labelW + w + 6, y: y + 13, class: 'value-label' });
      val.textContent = d.value + unit;
      svg.appendChild(val);
      var hit = el('rect', { x: 0, y: y - 4, width: W, height: rowH, fill: 'transparent', tabindex: 0 });
      bindHover(hit, '<strong>' + esc(d.label) + '</strong><br>' + esc(d.value + unit) + (d.note ? '<br><span class="muted">' + esc(d.note) + '</span>' : ''));
      svg.appendChild(hit);
    });

    container.innerHTML = '';
    container.appendChild(svg);
    appendTable(container, [opts.labelHeader || '항목', opts.valueHeader || '값'], items.map(function (d) { return [d.label, d.value + unit]; }));
  }

  /* 세로 막대 — 시간 축(월). series: [{name, cls, values[]}], 계열 2개까지 */
  function columns(container, labels, series, opts) {
    opts = opts || {};
    var W = widthOf(container, 560), H = 220, padL = 32, padB = 28, padT = 12;
    var plotW = W - padL - 8, plotH = H - padB - padT;
    var all = [];
    series.forEach(function (s) { all = all.concat(s.values); });
    var max = niceMax(Math.max.apply(null, all.concat([1])));
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.title || '월별 차트' });

    [0, 0.5, 1].forEach(function (f) {
      var y = padT + plotH * (1 - f);
      svg.appendChild(el('line', { x1: padL, x2: W - 8, y1: y, y2: y, class: f === 0 ? 'baseline' : 'grid' }));
      var t = el('text', { x: padL - 6, y: y + 4, class: 'axis-label', 'text-anchor': 'end' });
      t.textContent = Math.round(max * f);
      svg.appendChild(t);
    });

    var groupW = plotW / labels.length;
    var barW = Math.min(18, (groupW - 8 - (series.length - 1) * 2) / series.length);
    labels.forEach(function (lab, i) {
      var gx = padL + i * groupW + (groupW - (barW * series.length + (series.length - 1) * 2)) / 2;
      series.forEach(function (s, si) {
        var v = s.values[i];
        var h = v > 0 ? Math.max(4, plotH * v / max) : 0;
        var x = gx + si * (barW + 2), y = padT + plotH - h;
        if (h > 0) {
          svg.appendChild(el('path', {
            d: 'M' + x + ',' + (padT + plotH) + 'v-' + (h - 4) + 'a4,4 0 0 1 4,-4h' + (barW - 8) + 'a4,4 0 0 1 4,4v' + (h - 4) + 'z',
            class: 'bar ' + (s.cls || '')
          }));
        }
      });
      var t = el('text', { x: padL + i * groupW + groupW / 2, y: H - 8, class: 'axis-label', 'text-anchor': 'middle' });
      t.textContent = lab;
      svg.appendChild(t);
      var hit = el('rect', { x: padL + i * groupW, y: padT, width: groupW, height: plotH, fill: 'transparent', tabindex: 0 });
      bindHover(hit, '<strong>' + esc(lab) + '</strong>' + series.map(function (s) {
        return '<br><span class="swatch ' + (s.cls || '') + '"></span>' + esc(s.name) + ' ' + s.values[i] + (opts.unit || '');
      }).join(''));
      svg.appendChild(hit);
    });

    container.innerHTML = '';
    if (series.length > 1) {
      var lg = document.createElement('div');
      lg.className = 'legend';
      lg.innerHTML = series.map(function (s) { return '<span><i class="swatch ' + (s.cls || '') + '"></i>' + esc(s.name) + '</span>'; }).join('');
      container.appendChild(lg);
    }
    container.appendChild(svg);
    appendTable(container, ['월'].concat(series.map(function (s) { return s.name; })), labels.map(function (l, i) {
      return [l].concat(series.map(function (s) { return s.values[i]; }));
    }));
  }

  /* 선 차트 — 평가 점수 추이(0~10). series 최대 2개 */
  function line(container, labels, series, opts) {
    opts = opts || {};
    var W = widthOf(container, 520), H = 200, padL = 28, padR = 48, padB = 28, padT = 14;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var max = opts.max || 10;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.title || '추이 차트' });
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + plotH * (1 - f);
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: f === 0 ? 'baseline' : 'grid' }));
      var t = el('text', { x: padL - 6, y: y + 4, class: 'axis-label', 'text-anchor': 'end' });
      t.textContent = max * f;
      svg.appendChild(t);
    });
    function px(i) { return labels.length === 1 ? padL + plotW / 2 : padL + plotW * i / (labels.length - 1); }
    function py(v) { return padT + plotH * (1 - v / max); }

    series.forEach(function (s) {
      var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + px(i) + ',' + py(v); }).join('');
      svg.appendChild(el('path', { d: d, class: 'line ' + (s.cls || '') }));
      s.values.forEach(function (v, i) {
        svg.appendChild(el('circle', { cx: px(i), cy: py(v), r: 4.5, class: 'dot ' + (s.cls || '') }));
      });
      var last = s.values.length - 1;
      var t = el('text', { x: px(last) + 8, y: py(s.values[last]) + 4, class: 'value-label' });
      t.textContent = s.name;
      svg.appendChild(t);
    });
    labels.forEach(function (lab, i) {
      var t = el('text', { x: px(i), y: H - 8, class: 'axis-label', 'text-anchor': 'middle' });
      t.textContent = lab;
      svg.appendChild(t);
      var w = labels.length === 1 ? plotW : plotW / (labels.length - 1);
      var hit = el('rect', { x: px(i) - w / 2, y: padT, width: w, height: plotH, fill: 'transparent', tabindex: 0 });
      bindHover(hit, '<strong>' + esc(lab) + '</strong>' + series.map(function (s) {
        return '<br><span class="swatch ' + (s.cls || '') + '"></span>' + esc(s.name) + ' ' + s.values[i] + '점';
      }).join(''));
      svg.appendChild(hit);
    });

    container.innerHTML = '';
    var lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = series.map(function (s) { return '<span><i class="swatch ' + (s.cls || '') + '"></i>' + esc(s.name) + '</span>'; }).join('');
    container.appendChild(lg);
    container.appendChild(svg);
    appendTable(container, ['평가일'].concat(series.map(function (s) { return s.name; })), labels.map(function (l, i) {
      return [l].concat(series.map(function (s) { return s.values[i]; }));
    }));
  }

  function appendTable(container, headers, rows) {
    var d = document.createElement('details');
    d.className = 'table-toggle';
    d.innerHTML = '<summary>표로 보기</summary>' + tableHtml(headers, rows);
    container.appendChild(d);
  }

  window.Charts = { hbar: hbar, columns: columns, line: line, esc: esc, hideTip: hideTip };
})();
