/* PPP 이야기 서재 — 화면 렌더링과 라우팅 */
(function () {
  'use strict';

  var S = window.Store;
  var esc = window.Charts.esc;
  var $main = document.getElementById('main');

  // 실천 단계 이용자의 모니터링 상담 권장 간격(일). 기관 규칙 확인 필요 — PROJECT_SPEC.md 미확정 사항 참고.
  var MONITOR_DAYS = 60;
  var FONT_STEPS = [14, 16, 18, 20];

  var STAGE_DESC = {
    '준비': '아카데미·준비상담·가족지원 단계',
    '계획': '상담 → 사전·통합·컨퍼런스·확정회의 → 단기계획 수립',
    '실천': '세부계획 확인 · 실천활동 · 활동평가',
    '평가': '연 1회 실천과정 평가 후 다음 해 계획에 반영'
  };

  var ui = {
    view: pref('view', 'shelf'),
    q: '', stage: '', worker: '', sort: 'recent',
    chapter: 'summary', analyticsMonths: 6
  };

  /* ---------- 유틸 ---------- */
  function pref(k, d) { try { return localStorage.getItem('ppp.pref.' + k) || d; } catch (e) { return d; } }
  function setPref(k, v) { try { localStorage.setItem('ppp.pref.' + k, v); } catch (e) { /* 무시 */ } }
  function today() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
  function fmtDate(d) { return d ? d.replace(/-/g, '.') : '—'; }
  function byDateDesc(a, b) { return (b.date || '').localeCompare(a.date || ''); }
  function age(birthYM) {
    if (!birthYM) return '';
    var p = birthYM.split('-'), n = new Date();
    var a = n.getFullYear() - +p[0] - ((n.getMonth() + 1) < +p[1] ? 1 : 0);
    return a + '세';
  }
  function monthKeys(n) {
    var out = [], d = new Date();
    d.setDate(1);
    for (var i = n - 1; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'));
    }
    return out;
  }
  function monthLabel(k) { return +k.slice(5) + '월'; }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* 브라우저 confirm()은 일부 내장 화면(미리보기 등)에서 막히므로 페이지 안 확인창을 쓴다 */
  function ask(message, okLabel, onYes, onNo) {
    var dlg = document.getElementById('confirm');
    document.getElementById('confirm-msg').textContent = message;
    var ok = document.getElementById('confirm-ok');
    ok.textContent = okLabel;
    var answered = false;
    ok.onclick = function () { answered = true; dlg.close(); onYes(); };
    document.getElementById('confirm-cancel').onclick = function () { dlg.close(); };
    dlg.onclose = function () { if (!answered && onNo) onNo(); };
    dlg.showModal();
    document.getElementById('confirm-cancel').focus();
  }

  function stageBadge(stage) { return '<span class="stage-badge" data-stage="' + esc(stage) + '">' + esc(stage) + '</span>'; }

  /* ---------- 이용자별 요약 지표 ---------- */
  function personStats(p) {
    var progs = S.list('programs', p.id);
    var attended = progs.filter(function (r) { return r.attendance === '참여'; });
    var cons = S.list('consultations', p.id);
    var monitors = cons.filter(function (c) { return c.type === '모니터링상담'; }).sort(byDateDesc);
    var all = progs.concat(cons, S.list('evaluations', p.id), S.list('intakes', p.id));
    var last = all.map(function (r) { return r.date; }).sort().pop() || p.enrolledAt;
    var sat = attended.filter(function (r) { return r.satisfaction; });
    var lastMonitor = monitors[0] ? monitors[0].date : null;
    var needsMonitor = p.stage === '실천' && (!lastMonitor || daysBetween(lastMonitor, today()) > MONITOR_DAYS);
    return {
      programs: progs.length, attended: attended.length,
      hours: attended.reduce(function (s, r) { return s + (+r.hours || 0); }, 0),
      attendRate: progs.length ? Math.round(attended.length / progs.length * 100) : null,
      satisfaction: sat.length ? (sat.reduce(function (s, r) { return s + +r.satisfaction; }, 0) / sat.length).toFixed(1) : null,
      consultations: cons.length, lastActivity: last, lastMonitor: lastMonitor, needsMonitor: needsMonitor,
      goals: S.list('goals', p.id), evaluations: S.list('evaluations', p.id)
    };
  }

  /* ---------- 라우터 ---------- */
  function route() {
    window.Charts.hideTip();
    var h = location.hash.replace(/^#\/?/, '').split('/');
    var nav = 'village';
    var isVillage = h[0] === '' || h[0] === 'village';
    if (!isVillage && window.Village && window.Village.isMounted()) window.Village.unmount();
    if (!isVillage) $main.classList.remove('village-mode');
    if (!isVillage) document.title = 'PPP 이야기 서재';
    ui.refresh = null;
    if (isVillage) {
      var V = window.Village;
      if (!V || !V.isMounted()) {
        if (V && V.mount($main)) V.navigate(h[1] ? decodeURIComponent(h[1]) : null, h[2]);
      } else V.navigate(h[1] ? decodeURIComponent(h[1]) : null, h[2]);
      if (V && V.isMounted()) ui.refresh = V.refresh;
    } else if (h[0] === 'library') { nav = 'library'; renderHome(); }
    else if (h[0] === 'person' && h[1]) {
      var p = S.get('persons', decodeURIComponent(h[1]));
      if (!p) { renderNotFound(); }
      else { if (h[2]) ui.chapter = h[2]; renderPerson(p); }
    } else if (h[0] === 'analytics') { nav = 'analytics'; renderAnalytics(); }
    else if (h[0] === 'data') { nav = 'data'; renderData(); }
    else { nav = 'library'; renderHome(); }
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === nav && h[0] !== 'person') a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function renderNotFound() {
    $main.innerHTML = '<div class="empty"><strong>해당 이용자를 찾을 수 없습니다.</strong>삭제되었거나 잘못된 주소입니다.<br><br><a class="btn" href="#/library">서재로 돌아가기</a></div>';
  }

  /* ---------- 서재(대시보드) ---------- */
  function renderHome() {
    var persons = S.list('persons');
    var stats = {};
    persons.forEach(function (p) { stats[p.id] = personStats(p); });

    var thisMonth = today().slice(0, 7);
    var monthProg = S.list('programs').filter(function (r) { return r.date.slice(0, 7) === thisMonth && r.attendance === '참여'; }).length;
    var monthCons = S.list('consultations').filter(function (r) { return r.date.slice(0, 7) === thisMonth; }).length;
    var alerts = persons.filter(function (p) { return stats[p.id].needsMonitor; });
    var stageCount = {};
    S.STAGES.forEach(function (s) { stageCount[s] = persons.filter(function (p) { return p.stage === s; }).length; });
    var workers = Array.from(new Set(persons.map(function (p) { return p.worker; }).filter(Boolean))).sort();

    var html = '';
    html += '<div class="page-head"><div><span class="eyebrow">LIBRARY</span><h1>이용자 이야기 서재</h1>' +
      '<p>한 사람의 접수·계획·프로그램 이용·상담·평가 기록이 한 권의 책으로 모입니다. 책을 눌러 펼쳐 보세요.</p></div>' +
      '<button class="btn gold" type="button" id="add-person">＋ 새 이용자 등록</button></div>';

    html += '<section class="kpis" aria-label="현황 요약">' +
      kpi('전체 이용자', persons.length + '명', '등록된 책 ' + persons.length + '권') +
      '<div class="kpi"><div class="kpi-label">단계별 분포</div>' +
      '<div class="stage-dist" aria-hidden="true">' + S.STAGES.map(function (s) {
        return stageCount[s] ? '<span data-stage="' + s + '" style="flex:' + stageCount[s] + '"></span>' : '';
      }).join('') + '</div><div class="stage-dist-legend">' + S.STAGES.map(function (s) {
        return '<span data-stage="' + s + '"><i></i>' + s + ' ' + stageCount[s] + '</span>';
      }).join('') + '</div></div>' +
      kpi('이번 달 프로그램 참여', monthProg + '회', thisMonth.replace('-', '년 ') + '월') +
      kpi('이번 달 상담·회의', monthCons + '건', '모니터링 상담 포함') +
      '<div class="kpi' + (alerts.length ? ' alert' : '') + '"><div class="kpi-label">모니터링 확인 필요</div>' +
      '<div class="kpi-value">' + alerts.length + '명</div><div class="kpi-sub">실천 단계 · ' + MONITOR_DAYS + '일 이상 모니터링 없음' +
      (alerts.length ? ' · <button type="button" class="link" id="show-alerts">명단 보기</button>' : '') + '</div></div>' +
      '</section>';

    html += '<div id="alert-box" hidden></div>';

    html += '<div class="toolbar" role="search">' +
      '<label class="search"><span class="sr-only">이름·코드·담당자 검색</span><input type="search" id="q" placeholder="이름, 코드, 담당자, 꿈 검색" value="' + esc(ui.q) + '"></label>' +
      '<label><span class="sr-only">단계</span><select class="input" id="f-stage"><option value="">전체 단계</option>' +
      S.STAGES.map(function (s) { return '<option' + (ui.stage === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label><span class="sr-only">담당자</span><select class="input" id="f-worker"><option value="">전체 담당자</option>' +
      workers.map(function (w) { return '<option' + (ui.worker === w ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select></label>' +
      '<label><span class="sr-only">정렬</span><select class="input" id="f-sort">' +
      [['recent', '최근 활동순'], ['name', '이름순'], ['enrolled', '등록일순'], ['monitor', '모니터링 필요 우선']].map(function (o) {
        return '<option value="' + o[0] + '"' + (ui.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<span class="spacer"></span>' +
      '<div class="seg" role="group" aria-label="보기 방식"><button type="button" data-view="shelf" aria-pressed="' + (ui.view === 'shelf') + '">📚 서가</button>' +
      '<button type="button" data-view="table" aria-pressed="' + (ui.view === 'table') + '">☰ 목록</button></div></div>';

    html += '<div id="collection"></div>';
    $main.innerHTML = html;

    function refresh() {
      var q = ui.q.trim().toLowerCase();
      var list = persons.filter(function (p) {
        if (ui.stage && p.stage !== ui.stage) return false;
        if (ui.worker && p.worker !== ui.worker) return false;
        if (q && [p.name, p.code, p.worker, p.dream, p.oneLine].join(' ').toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (ui.sort === 'name') return a.name.localeCompare(b.name, 'ko');
        if (ui.sort === 'enrolled') return (b.enrolledAt || '').localeCompare(a.enrolledAt || '');
        if (ui.sort === 'monitor') return (stats[b.id].needsMonitor - stats[a.id].needsMonitor) || stats[b.id].lastActivity.localeCompare(stats[a.id].lastActivity);
        return stats[b.id].lastActivity.localeCompare(stats[a.id].lastActivity);
      });
      var box = document.getElementById('collection');
      if (!persons.length) {
        box.innerHTML = '<div class="empty"><strong>아직 등록된 이용자가 없습니다.</strong>‘새 이용자 등록’으로 첫 번째 책을 만들어 보세요. 데이터 관리 메뉴에서 가상 샘플 데이터를 불러올 수도 있습니다.</div>';
        return;
      }
      if (!list.length) {
        box.innerHTML = '<div class="empty"><strong>조건에 맞는 이용자가 없습니다.</strong>검색어나 필터를 바꿔 보세요.</div>';
        return;
      }
      box.innerHTML = ui.view === 'table' ? tableView(list, stats) : shelfView(list, stats);
    }

    refresh();

    document.getElementById('add-person').onclick = function () { personForm(); };
    document.getElementById('q').oninput = function (e) { ui.q = e.target.value; refresh(); };
    document.getElementById('f-stage').onchange = function (e) { ui.stage = e.target.value; refresh(); };
    document.getElementById('f-worker').onchange = function (e) { ui.worker = e.target.value; refresh(); };
    document.getElementById('f-sort').onchange = function (e) { ui.sort = e.target.value; refresh(); };
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = function () {
        ui.view = b.getAttribute('data-view'); setPref('view', ui.view);
        document.querySelectorAll('[data-view]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        refresh();
      };
    });
    var sa = document.getElementById('show-alerts');
    if (sa) sa.onclick = function () {
      var box = document.getElementById('alert-box');
      box.hidden = !box.hidden;
      box.innerHTML = '<div class="card" style="margin-bottom:24px"><h2>모니터링 확인 필요 명단</h2><ul class="alert-list">' +
        alerts.map(function (p) {
          var s = stats[p.id];
          return '<li>' + stageBadge(p.stage) + '<a href="#/person/' + encodeURIComponent(p.id) + '/consult"><strong>' + esc(p.name) + '</strong></a>' +
            '<span class="muted">' + esc(p.code) + ' · 담당 ' + esc(p.worker) + '</span><span style="margin-left:auto">' +
            (s.lastMonitor ? '마지막 모니터링 ' + fmtDate(s.lastMonitor) + ' (' + daysBetween(s.lastMonitor, today()) + '일 전)' : '모니터링 기록 없음') + '</span></li>';
        }).join('') + '</ul></div>';
    };
    $main.addEventListener('click', openBookHandler);
  }

  function openBookHandler(e) {
    var t = e.target.closest('[data-open]');
    if (t) { ui.chapter = 'summary'; location.hash = '#/person/' + encodeURIComponent(t.getAttribute('data-open')); }
  }

  function kpi(label, value, sub) {
    return '<div class="kpi"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + esc(value) + '</div><div class="kpi-sub">' + esc(sub) + '</div></div>';
  }

  function shelfView(list, stats) {
    var stages = ui.stage ? [ui.stage] : S.STAGES;
    return stages.map(function (stage) {
      var books = list.filter(function (p) { return p.stage === stage; });
      return '<section class="shelf" aria-labelledby="shelf-' + stage + '"><div class="shelf-head" data-stage="' + stage + '">' +
        '<h2 id="shelf-' + stage + '">' + stage + ' 서가</h2><span class="muted">' + books.length + '권</span></div>' +
        '<div class="shelf-desc">' + esc(STAGE_DESC[stage]) + '</div><div class="shelf-row">' +
        (books.length ? books.map(function (p) { return bookCover(p, stats[p.id]); }).join('') : '<div class="shelf-empty">이 단계의 이용자가 없습니다.</div>') +
        '</div></section>';
    }).join('');
  }

  function bookCover(p, s) {
    return '<button type="button" class="book" data-open="' + esc(p.id) + '" data-stage="' + esc(p.stage) + '" aria-label="' + esc(p.name) + '의 책 펼치기, ' + esc(p.stage) + ' 단계">' +
      '<span class="book-ribbon" aria-hidden="true"></span>' +
      '<span class="book-code">' + esc(p.code) + '</span>' +
      '<span class="book-title">' + esc(p.name) + '의 이야기</span>' +
      '<span class="book-sub">' + esc([p.gender, age(p.birthYM)].filter(Boolean).join(' · ')) + '</span>' +
      (p.oneLine ? '<span class="book-line">“' + esc(p.oneLine) + '”</span>' : '') +
      '<span class="book-foot">' + stageBadge(p.stage) +
      '<span class="book-stats"><span>프로그램 ' + s.attended + '</span><span>상담 ' + s.consultations + '</span></span>' +
      '<span>최근 ' + fmtDate(s.lastActivity) + '</span>' +
      (s.needsMonitor ? '<span class="book-flag">● 모니터링 확인 필요</span>' : '') +
      '</span></button>';
  }

  function tableView(list, stats) {
    return '<div class="table-wrap"><table class="data-table"><caption class="sr-only">이용자 목록</caption><thead><tr>' +
      '<th scope="col">코드</th><th scope="col">이름</th><th scope="col">단계</th><th scope="col">담당자</th><th scope="col">등록일</th>' +
      '<th scope="col" class="num">프로그램 참여</th><th scope="col" class="num">출석률</th><th scope="col" class="num">상담·회의</th><th scope="col">최근 활동</th><th scope="col">확인</th>' +
      '</tr></thead><tbody>' + list.map(function (p) {
        var s = stats[p.id];
        return '<tr class="clickable" data-open="' + esc(p.id) + '"><td>' + esc(p.code) + '</td>' +
          '<td><a href="#/person/' + encodeURIComponent(p.id) + '"><strong>' + esc(p.name) + '</strong></a></td>' +
          '<td>' + stageBadge(p.stage) + '</td><td>' + esc(p.worker) + '</td><td>' + fmtDate(p.enrolledAt) + '</td>' +
          '<td class="num">' + s.attended + '회</td><td class="num">' + (s.attendRate == null ? '—' : s.attendRate + '%') + '</td>' +
          '<td class="num">' + s.consultations + '건</td><td>' + fmtDate(s.lastActivity) + '</td>' +
          '<td>' + (s.needsMonitor ? '<span class="status s-조정">모니터링 필요</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- 펼친 책(개인 상세) ---------- */
  var CHAPTERS = [
    { id: 'summary', no: '', title: '한눈에 보기' },
    { id: 'intake', no: '1장', title: '초기접수', col: 'intakes' },
    { id: 'goals', no: '2장', title: '꿈과 계획', col: 'goals' },
    { id: 'program', no: '3장', title: '프로그램 이용', col: 'programs' },
    { id: 'consult', no: '4장', title: '상담·회의', col: 'consultations' },
    { id: 'eval', no: '5장', title: '평가', col: 'evaluations' },
    { id: 'timeline', no: '부록', title: '전체 타임라인' }
  ];

  function renderPerson(p) {
    var s = personStats(p);
    var si = S.STAGES.indexOf(p.stage);
    if (!CHAPTERS.some(function (c) { return c.id === ui.chapter; })) ui.chapter = 'summary';

    var left = '<aside class="page-left" data-stage="' + esc(p.stage) + '">' +
      '<a href="#/library" class="btn small no-print" style="margin-bottom:18px">← 서재로</a>' +
      '<div class="code">' + esc(p.code) + '</div><h1>' + esc(p.name) + '</h1>' +
      '<div class="facts">' + esc([p.gender, p.birthYM ? p.birthYM.replace('-', '년 ') + '월생 (' + age(p.birthYM) + ')' : '', p.disabilityType].filter(Boolean).join(' · ')) + '</div>' +
      stageBadge(p.stage) +
      '<ol class="stepper" aria-label="평생과정설계 단계">' + S.STAGES.map(function (st, i) {
        return '<li class="' + (i < si ? 'done' : i === si ? 'current' : '') + '"' + (i === si ? ' aria-current="step"' : '') + '>' + st + '</li>';
      }).join('') + '</ol>' +
      (p.oneLine ? '<p class="quote">“' + esc(p.oneLine) + '”</p>' : '') +
      '<dl>' +
      dd('나의 꿈', p.dream) + dd('내가 잘하는 것', p.strengths) + dd('좋아하는 것', p.likes) +
      dd('어렵게 하는 것', p.dislikes) + dd('나를 편안하게 하는 방법', p.comfort) +
      '<dt>우선 영역</dt><dd>' + ((p.priorities || []).length ? p.priorities.map(function (d, i) { return '<span class="chip">' + (i + 1) + '. ' + esc(d) + '</span>'; }).join('') : '—') + '</dd>' +
      dd('담당자', p.worker) + dd('등록일', fmtDate(p.enrolledAt)) +
      '</dl><div class="actions no-print">' +
      '<button type="button" class="btn small" id="edit-person">정보 수정</button>' +
      '<button type="button" class="btn small" id="print-book">PDF·인쇄</button>' +
      '<button type="button" class="btn small" id="del-person">삭제</button></div></aside>';

    var counts = {
      intake: S.list('intakes', p.id).length, goals: s.goals.length, program: s.programs,
      consult: s.consultations, eval: s.evaluations.length
    };
    var toc = '<div class="toc" role="tablist" aria-label="목차">' + CHAPTERS.map(function (c) {
      return '<button type="button" role="tab" id="tab-' + c.id + '" aria-controls="ch-' + c.id + '" aria-selected="' + (ui.chapter === c.id) + '" tabindex="' + (ui.chapter === c.id ? 0 : -1) + '" data-ch="' + c.id + '">' +
        (c.no ? c.no + ' ' : '') + c.title + (counts[c.id] != null ? '<small>' + counts[c.id] + '</small>' : '') + '</button>';
    }).join('') + '</div>';

    var right = '<section class="page-right">' + toc +
      '<div class="print-only"><h2>' + esc(p.name) + '의 평생과정설계 기록</h2><p class="muted">출력일 ' + fmtDate(today()) + ' · 외부 반출 시 개인정보 보호 지침을 따르세요.</p></div>' +
      CHAPTERS.map(function (c) {
        return '<div class="chapter" role="tabpanel" id="ch-' + c.id + '" aria-labelledby="tab-' + c.id + '"' + (ui.chapter === c.id ? '' : ' hidden') + '>' + chapterHtml(c, p, s) + '</div>';
      }).join('') + '</section>';

    $main.innerHTML = '<article class="book-open" aria-label="' + esc(p.name) + '의 책">' + left + right + '</article>';
    drawPersonCharts(p, s);

    document.getElementById('edit-person').onclick = function () { personForm(p); };
    document.getElementById('print-book').onclick = function () {
      if (window.PPP_PREVIEW) { toast('미리보기에서는 인쇄가 막혀 있습니다. 설치한 앱에서 사용하세요.'); return; }
      window.print();
    };
    document.getElementById('del-person').onclick = function () {
      ask('“' + p.name + '”님의 책과 모든 기록(접수·계획·프로그램·상담·평가)을 삭제합니다. 삭제 전에 데이터 관리에서 백업을 권장합니다.', '삭제', function () {
        Promise.resolve(S.remove('persons', p.id)).then(function () { toast('삭제했습니다.'); location.hash = '#/library'; }, function (e) { toast(e.message); });
      });
    };

    var tabs = Array.from(document.querySelectorAll('.toc [role="tab"]'));
    tabs.forEach(function (b, i) {
      b.onclick = function () { selectChapter(b.getAttribute('data-ch')); };
      b.onkeydown = function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (j == null) return;
        e.preventDefault();
        j = (j + tabs.length) % tabs.length;
        selectChapter(tabs[j].getAttribute('data-ch'));
        tabs[j].focus();
      };
    });

    bindChapterActions($main, p);
  }

  /* 장 안의 추가·수정·삭제 버튼 연결 — 펼친 책과 3D 마을의 방 패널이 함께 쓴다 */
  function bindChapterActions(root, p) {
    root.querySelectorAll('[data-add]').forEach(function (b) {
      b.onclick = function () { recordForm(b.getAttribute('data-add'), p); };
    });
    root.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var parts = b.getAttribute('data-edit').split(':');
        recordForm(parts[0], p, S.get(parts[0], parts[1]));
      };
    });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var parts = b.getAttribute('data-del').split(':');
        ask(S.isRemote() ? '이 기록을 삭제합니다. 관리자는 보관함에서 되살릴 수 있습니다.' : '이 기록을 삭제합니다. 되돌릴 수 없습니다.', '삭제', function () {
          Promise.resolve(S.remove(parts[0], parts[1])).then(function () { toast('기록을 삭제했습니다.'); refreshView(); }, function (e) { toast(e.message); });
        });
      };
    });
    root.querySelectorAll('[data-goto]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-goto');
        if (ui.refresh) location.hash = '#/village/' + encodeURIComponent(p.id) + '/' + id;
        else selectChapter(id);
      };
    });
  }

  function refreshView() {
    if (!(ui.refresh && ui.refresh())) route();
  }

  function selectChapter(id) {
    ui.chapter = id;
    document.querySelectorAll('.toc [role="tab"]').forEach(function (t) {
      var on = t.getAttribute('data-ch') === id;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.chapter').forEach(function (c) { c.hidden = c.id !== 'ch-' + id; });
    if (id === 'summary') {
      var p = S.get('persons', decodeURIComponent(location.hash.split('/')[2]));
      if (p) drawPersonCharts(p, personStats(p));
    }
    var h = location.hash.split('/');
    history.replaceState(null, '', '#/person/' + h[2] + '/' + id);
  }

  function dd(label, v) { return '<dt>' + esc(label) + '</dt><dd>' + (v ? esc(v) : '—') + '</dd>'; }

  function chapterHead(c, addCol, addLabel) {
    return '<div class="chapter-head"><h2><span class="chapter-no">' + esc(c.no || 'OVERVIEW') + '</span>' + esc(c.title) + '</h2>' +
      (addCol ? '<button type="button" class="btn small primary no-print" data-add="' + addCol + '">＋ ' + esc(addLabel) + '</button>' : '') + '</div>';
  }

  function tools(col, id) {
    return '<span class="tools no-print"><button type="button" class="icon-btn" data-edit="' + col + ':' + esc(id) + '" aria-label="수정">✎</button>' +
      '<button type="button" class="icon-btn" data-del="' + col + ':' + esc(id) + '" aria-label="삭제">🗑</button></span>';
  }

  function emptyBlock(title, hint) { return '<div class="empty"><strong>' + esc(title) + '</strong>' + esc(hint) + '</div>'; }

  function chapterHtml(c, p, s) {
    if (c.id === 'summary') {
      var activeGoals = s.goals.filter(function (g) { return g.term === '단기'; });
      var done = activeGoals.filter(function (g) { return g.status === '달성'; }).length;
      return chapterHead(c) +
        '<div class="mini-kpis">' +
        mini(s.attended + '회', '프로그램 참여') +
        mini(s.hours + '시간', '누적 참여시간') +
        mini(s.attendRate == null ? '—' : s.attendRate + '%', '출석률') +
        mini(s.satisfaction || '—', '평균 만족도(5점)') +
        mini(activeGoals.length ? done + '/' + activeGoals.length : '—', '단기목표 달성') +
        mini(s.lastMonitor ? daysBetween(s.lastMonitor, today()) + '일 전' : '없음', '마지막 모니터링') +
        '</div>' +
        (s.needsMonitor ? '<div class="notice">실천 단계에서 ' + MONITOR_DAYS + '일 이상 모니터링 상담 기록이 없습니다. <button type="button" class="btn small" data-goto="consult">상담 기록으로</button></div>' : '') +
        '<div class="grid-2">' +
        '<div class="panel"><h3>영역별 프로그램 참여</h3><p class="desc">참여 횟수 · 진한 막대는 이용자가 정한 우선 영역</p><div id="c-domain"></div></div>' +
        '<div class="panel"><h3>평가 점수 추이</h3><p class="desc">‘점수로 평가하기’ 10점 만점 · 당사자 vs 담당자</p><div id="c-eval"></div></div>' +
        '<div class="panel"><h3>최근 6개월 활동</h3><p class="desc">월별 프로그램 참여 횟수</p><div id="c-month"></div></div>' +
        '<div class="panel"><h3>진행 중인 목표</h3>' + goalMiniList(s.goals) + '</div>' +
        '</div>';
    }
    if (c.id === 'intake') {
      var intakes = S.list('intakes', p.id).sort(byDateDesc);
      return chapterHead(c, 'intakes', '초기접수 기록') + (intakes.length ? '<ul class="entries">' + intakes.map(function (r) {
        return '<li class="entry kind-intake"><div class="entry-head"><span class="date">' + fmtDate(r.date) + '</span><strong>초기접수</strong>' +
          '<span class="chip navy">' + esc(r.route) + '</span><span class="muted">신청: ' + esc(r.applicant || '—') + '</span>' + tools('intakes', r.id) + '</div>' +
          '<p><span class="label">욕구·주호소</span>' + esc(r.needs) + '</p>' +
          ((r.interestDomains || []).length ? '<p><span class="label">관심 영역</span>' + r.interestDomains.map(function (d) { return '<span class="chip">' + esc(d) + '</span>'; }).join('') + '</p>' : '') +
          (r.notes ? '<p><span class="label">비고</span>' + esc(r.notes) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : emptyBlock('초기접수 기록이 없습니다.', '첫 상담 시 접수 내용을 기록해 주세요.'));
    }
    if (c.id === 'goals') {
      var goals = s.goals.slice().sort(function (a, b) { return (a.term === b.term ? 0 : a.term === '중장기' ? -1 : 1) || (a.priority || 9) - (b.priority || 9); });
      return chapterHead(c, 'goals', '목표 추가') + (goals.length ? '<ul class="entries">' + goals.map(function (g) {
        return '<li class="entry kind-goal"><div class="entry-head"><span class="chip navy">' + esc(g.term) + '</span><span class="chip">' + esc(g.domain) + '</span>' +
          '<span class="status s-' + esc(g.status) + '">' + esc(g.status) + '</span>' +
          '<span class="date">' + fmtDate(g.startDate) + (g.endDate ? ' ~ ' + fmtDate(g.endDate) : '') + '</span>' + tools('goals', g.id) + '</div>' +
          '<p><strong>' + esc(g.text) + '</strong></p>' + (g.plan ? '<p><span class="label">실천계획</span>' + esc(g.plan) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : emptyBlock('아직 수립된 목표가 없습니다.', '확정회의 후 중장기·단기목표와 실천계획을 기록하세요.'));
    }
    if (c.id === 'program') {
      var progs = S.list('programs', p.id).sort(byDateDesc);
      return chapterHead(c, 'programs', '이용 내역 추가') + (progs.length ? '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        '<th scope="col">날짜</th><th scope="col">프로그램</th><th scope="col">영역</th><th scope="col" class="num">시간</th><th scope="col">참여</th><th scope="col" class="num">만족도</th><th scope="col">관찰 내용</th><th scope="col" class="no-print"><span class="sr-only">관리</span></th></tr></thead><tbody>' +
        progs.map(function (r) {
          return '<tr><td>' + fmtDate(r.date) + '</td><td>' + esc(r.programName) + '</td><td>' + esc(r.domain) + '</td><td class="num">' + esc(r.hours || '—') + '</td>' +
            '<td>' + esc(r.attendance) + '</td><td class="num">' + (r.satisfaction ? esc(r.satisfaction) + '/5' : '—') + '</td><td>' + esc(r.note || '') + '</td><td class="no-print">' + tools('programs', r.id) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : emptyBlock('프로그램 이용 내역이 없습니다.', '참여한 프로그램과 출결·만족도를 기록하세요.'));
    }
    if (c.id === 'consult') {
      var cons = S.list('consultations', p.id).sort(byDateDesc);
      return chapterHead(c, 'consultations', '상담·회의 기록') + (cons.length ? '<ul class="entries">' + cons.map(function (r) {
        return '<li class="entry kind-consult"><div class="entry-head"><span class="date">' + fmtDate(r.date) + '</span><strong>' + esc(r.type) + '</strong>' +
          (r.participants ? '<span class="muted">참석: ' + esc(r.participants) + '</span>' : '') + tools('consultations', r.id) + '</div>' +
          '<p>' + esc(r.summary) + '</p>' + (r.nextAction ? '<p><span class="label">다음 할 일</span>' + esc(r.nextAction) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : emptyBlock('상담·회의 기록이 없습니다.', '초기상담, 지원회의, 모니터링 상담 내용을 기록하세요.'));
    }
    if (c.id === 'eval') {
      var evs = s.evaluations.slice().sort(byDateDesc);
      return chapterHead(c, 'evaluations', '평가 기록') + (evs.length ? '<ul class="entries">' + evs.map(function (r) {
        return '<li class="entry kind-eval"><div class="entry-head"><span class="date">' + fmtDate(r.date) + '</span><strong>' + esc(r.period) + ' 평가</strong>' +
          '<span class="chip">당사자 ' + esc(r.selfScore) + '점</span>' + (r.workerScore !== '' && r.workerScore != null ? '<span class="chip navy">담당자 ' + esc(r.workerScore) + '점</span>' : '') + tools('evaluations', r.id) + '</div>' +
          (r.achieved ? '<p><span class="label">변화·성과</span>' + esc(r.achieved) + '</p>' : '') +
          (r.adjust ? '<p><span class="label">계획 조정</span>' + esc(r.adjust) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : emptyBlock('평가 기록이 없습니다.', '월·분기·반기 활동평가와 연 1회 실천과정 평가를 기록하세요.'));
    }
    if (c.id === 'timeline') {
      var items = [];
      S.list('intakes', p.id).forEach(function (r) { items.push({ date: r.date, kind: '접수', color: 'var(--stage-준비)', text: r.route + ' · ' + r.needs }); });
      S.list('consultations', p.id).forEach(function (r) { items.push({ date: r.date, kind: r.type, color: 'var(--gold-500)', text: r.summary }); });
      S.list('programs', p.id).forEach(function (r) { items.push({ date: r.date, kind: '프로그램', color: 'var(--navy-500)', text: r.programName + ' (' + r.attendance + ')' + (r.note ? ' — ' + r.note : '') }); });
      S.list('evaluations', p.id).forEach(function (r) { items.push({ date: r.date, kind: r.period + ' 평가', color: 'var(--stage-평가)', text: '당사자 ' + r.selfScore + '점 · ' + (r.achieved || '') }); });
      s.goals.forEach(function (g) { items.push({ date: g.startDate, kind: g.term + '목표', color: 'var(--stage-계획)', text: '[' + g.domain + '] ' + g.text }); });
      items = items.filter(function (i) { return i.date; }).sort(byDateDesc);
      return chapterHead(c) + (items.length ? '<ol class="timeline">' + items.map(function (i) {
        return '<li style="--tl:' + i.color + '"><div class="date">' + fmtDate(i.date) + '</div><span class="kind">' + esc(i.kind) + '</span>' + esc(i.text) + '</li>';
      }).join('') + '</ol>' : emptyBlock('기록이 없습니다.', '각 장에 기록을 추가하면 이곳에 시간순으로 모입니다.'));
    }
    return '';
  }

  function mini(v, l) { return '<div class="mini-kpi"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>'; }

  function goalMiniList(goals) {
    var g = goals.filter(function (x) { return x.term === '단기' && x.status !== '중단'; });
    if (!g.length) return '<p class="muted">진행 중인 단기목표가 없습니다.</p>';
    return '<ul class="alert-list">' + g.map(function (x) {
      return '<li><span class="chip">' + esc(x.domain) + '</span>' + esc(x.text) + '<span class="status s-' + esc(x.status) + '" style="margin-left:auto">' + esc(x.status) + '</span></li>';
    }).join('') + '</ul>';
  }

  function drawPersonCharts(p, s) {
    var progs = S.list('programs', p.id).filter(function (r) { return r.attendance === '참여'; });
    var cd = document.getElementById('c-domain');
    if (cd) {
      window.Charts.hbar(cd, S.DOMAINS.map(function (d) {
        var pri = (p.priorities || []).indexOf(d);
        return { label: d, value: progs.filter(function (r) { return r.domain === d; }).length, highlight: pri >= 0, note: pri >= 0 ? '우선 영역 ' + (pri + 1) + '순위' : '' };
      }), { unit: '회', title: '영역별 프로그램 참여 횟수', labelHeader: '영역', valueHeader: '참여 횟수' });
    }
    var ce = document.getElementById('c-eval');
    if (ce) {
      var evs = s.evaluations.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      if (evs.length) {
        window.Charts.line(ce, evs.map(function (e) { return e.date.slice(2, 7).replace('-', '.'); }), [
          { name: '당사자', cls: 's1', values: evs.map(function (e) { return +e.selfScore; }) },
          { name: '담당자', cls: 's2', values: evs.map(function (e) { return +(e.workerScore || 0); }) }
        ], { title: '평가 점수 추이' });
      } else ce.innerHTML = '<p class="muted">평가 기록이 쌓이면 추이가 표시됩니다.</p>';
    }
    var cm = document.getElementById('c-month');
    if (cm) {
      var keys = monthKeys(6);
      window.Charts.columns(cm, keys.map(monthLabel), [
        { name: '프로그램 참여', cls: 's1', values: keys.map(function (k) { return progs.filter(function (r) { return r.date.slice(0, 7) === k; }).length; }) }
      ], { unit: '회', title: '월별 프로그램 참여' });
    }
  }

  /* ---------- 전체 분석 ---------- */
  function renderAnalytics() {
    var months = ui.analyticsMonths;
    var keys = monthKeys(months);
    var from = keys[0] + '-01';
    var persons = S.list('persons');
    var progs = S.list('programs').filter(function (r) { return r.date >= from; });
    var attended = progs.filter(function (r) { return r.attendance === '참여'; });
    var cons = S.list('consultations').filter(function (r) { return r.date >= from; });
    var goals = S.list('goals').filter(function (g) { return g.term === '단기'; });

    var html = '<div class="page-head"><div><span class="eyebrow">ANALYTICS</span><h1>전체 분석</h1><p>모든 이용자의 기록을 영역·기간·담당자 기준으로 모아 봅니다.</p></div>' +
      '<div class="seg" role="group" aria-label="기간">' + [3, 6, 12].map(function (m) {
        return '<button type="button" data-months="' + m + '" aria-pressed="' + (months === m) + '">최근 ' + m + '개월</button>';
      }).join('') + '</div></div>';

    var rate = progs.length ? Math.round(attended.length / progs.length * 100) : 0;
    var sat = attended.filter(function (r) { return r.satisfaction; });
    var avgSat = sat.length ? (sat.reduce(function (a, r) { return a + +r.satisfaction; }, 0) / sat.length).toFixed(1) : '—';
    var reached = goals.filter(function (g) { return g.status === '달성'; }).length;
    html += '<section class="kpis">' +
      kpi('프로그램 참여', attended.length + '회', '참여 인원 ' + new Set(attended.map(function (r) { return r.personId; })).size + '명') +
      kpi('평균 출석률', progs.length ? rate + '%' : '—', '참여 / 전체 일정') +
      kpi('평균 만족도', avgSat, '5점 만점') +
      kpi('상담·회의', cons.length + '건', '모니터링 ' + cons.filter(function (c) { return c.type === '모니터링상담'; }).length + '건') +
      kpi('단기목표 달성', goals.length ? Math.round(reached / goals.length * 100) + '%' : '—', reached + ' / ' + goals.length + '개 (전체 기간)') +
      '</section>';

    html += '<div class="grid-2">' +
      '<div class="panel"><h3>영역별 프로그램 참여</h3><p class="desc">선택 기간 · 참여 횟수</p><div id="a-domain"></div></div>' +
      '<div class="panel"><h3>월별 활동 추이</h3><p class="desc">프로그램 참여 횟수와 상담·회의 건수</p><div id="a-month"></div></div>' +
      '<div class="panel"><h3>영역별 우선순위 선택 인원</h3><p class="desc">이용자가 1~3순위로 고른 희망 영역(전체)</p><div id="a-priority"></div></div>' +
      '<div class="panel"><h3>영역별 단기목표 현황</h3><p class="desc">전체 기간 · 상태별 개수</p>' + goalTable(goals) + '</div>' +
      '</div>';

    html += '<div class="panel" style="margin-top:18px"><h3>담당자별 현황</h3>' + workerTable(persons) + '</div>';
    $main.innerHTML = html;

    $main.querySelectorAll('[data-months]').forEach(function (b) {
      b.onclick = function () { ui.analyticsMonths = +b.getAttribute('data-months'); renderAnalytics(); };
    });

    if (!persons.length) return;
    window.Charts.hbar(document.getElementById('a-domain'), S.DOMAINS.map(function (d) {
      return { label: d, value: attended.filter(function (r) { return r.domain === d; }).length };
    }).sort(function (a, b) { return b.value - a.value; }), { unit: '회', labelHeader: '영역', valueHeader: '참여 횟수' });
    window.Charts.columns(document.getElementById('a-month'), keys.map(monthLabel), [
      { name: '프로그램 참여', cls: 's1', values: keys.map(function (k) { return attended.filter(function (r) { return r.date.slice(0, 7) === k; }).length; }) },
      { name: '상담·회의', cls: 's2', values: keys.map(function (k) { return cons.filter(function (r) { return r.date.slice(0, 7) === k; }).length; }) }
    ], { unit: '건' });
    window.Charts.hbar(document.getElementById('a-priority'), S.DOMAINS.map(function (d) {
      var n = persons.filter(function (p) { return (p.priorities || []).indexOf(d) >= 0; }).length;
      var first = persons.filter(function (p) { return (p.priorities || [])[0] === d; }).length;
      return { label: d, value: n, note: '1순위 ' + first + '명' };
    }).sort(function (a, b) { return b.value - a.value; }), { unit: '명', labelHeader: '영역', valueHeader: '선택 인원' });
  }

  function goalTable(goals) {
    if (!goals.length) return '<p class="muted">단기목표가 없습니다.</p>';
    return '<div class="table-wrap"><table class="data-table compact"><thead><tr><th scope="col">영역</th>' +
      S.GOAL_STATUS.map(function (s) { return '<th scope="col" class="num">' + s + '</th>'; }).join('') + '<th scope="col" class="num">달성률</th></tr></thead><tbody>' +
      S.DOMAINS.map(function (d) {
        var g = goals.filter(function (x) { return x.domain === d; });
        if (!g.length) return '';
        var done = g.filter(function (x) { return x.status === '달성'; }).length;
        return '<tr><th scope="row">' + esc(d) + '</th>' + S.GOAL_STATUS.map(function (s) {
          return '<td class="num">' + g.filter(function (x) { return x.status === s; }).length + '</td>';
        }).join('') + '<td class="num">' + Math.round(done / g.length * 100) + '%</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function workerTable(persons) {
    var workers = Array.from(new Set(persons.map(function (p) { return p.worker; }).filter(Boolean))).sort();
    if (!workers.length) return '<p class="muted">담당자 정보가 없습니다.</p>';
    return '<div class="table-wrap"><table class="data-table compact"><thead><tr><th scope="col">담당자</th>' +
      S.STAGES.map(function (s) { return '<th scope="col" class="num">' + s + '</th>'; }).join('') +
      '<th scope="col" class="num">합계</th><th scope="col" class="num">모니터링 확인 필요</th></tr></thead><tbody>' +
      workers.map(function (w) {
        var mine = persons.filter(function (p) { return p.worker === w; });
        return '<tr><th scope="row">' + esc(w) + '</th>' + S.STAGES.map(function (s) {
          return '<td class="num">' + mine.filter(function (p) { return p.stage === s; }).length + '</td>';
        }).join('') + '<td class="num">' + mine.length + '</td><td class="num">' + mine.filter(function (p) { return personStats(p).needsMonitor; }).length + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- 데이터 관리 ---------- */
  function downloadBackup() {
    if (window.PPP_PREVIEW) { toast('미리보기에서는 파일 내려받기가 막혀 있습니다.'); return; }
    var blob = new Blob([S.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ppp-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('백업 파일을 내려받았습니다.');
  }

  function renderDataRemote() {
    var c = S.counts(), me = S.me();
    var canImport = me && (me.role === 'admin' || me.role === 'manager');
    $main.innerHTML = '<div class="page-head"><div><span class="eyebrow">DATA</span><h1>데이터 관리</h1><p>Supabase 서버에 저장된 기록을 관리합니다.</p></div></div>' +
      '<div class="notice">서버에 연결되어 있습니다. 로그인: <strong>' + esc(me.name) + '</strong> (' + esc(ROLE_LABEL[me.role] || me.role) + '). ' +
      (me.role === 'worker' ? '담당 이용자의 기록만 보입니다.' : '전체 이용자의 기록이 보입니다.') +
      ' 다른 직원이 고친 내용은 새로고침하면 보입니다.</div>' +
      '<div class="stack">' +
      '<section class="card"><h2>내가 볼 수 있는 데이터</h2><div class="table-wrap"><table class="data-table compact"><tbody>' +
      [['이용자', c.persons], ['초기접수', c.intakes], ['목표', c.goals], ['프로그램 이용', c.programs], ['상담·회의', c.consultations], ['평가', c.evaluations]].map(function (r) {
        return '<tr><th scope="row">' + r[0] + '</th><td class="num">' + r[1] + '건</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="row-actions" style="margin-top:12px"><button type="button" class="btn" id="reload">서버에서 다시 불러오기</button></div></section>' +
      '<section class="card"><h2>백업 내려받기</h2><p>지금 보이는 데이터를 JSON 파일로 저장합니다. 이용자 정보가 들어 있으므로 기관이 정한 보안 저장소에만 보관하세요.</p>' +
      '<button type="button" class="btn primary" id="backup">백업 파일 내려받기</button></section>' +
      (canImport ? '<section class="card"><h2>서버로 옮기기</h2><p>예전 브라우저 버전에서 내려받은 백업 파일을 서버에 <strong>추가</strong>합니다. 기존 서버 데이터는 지워지지 않습니다. ' +
        '관리코드는 서버가 새로 매기고, 담당자 이름이 직원 명단과 같으면 그 직원에게, 아니면 나에게 배정됩니다.</p>' +
        '<div class="row-actions"><label class="btn" for="import-file">백업 파일 선택…</label><input type="file" id="import-file" accept="application/json,.json" class="sr-only">' +
        '<button type="button" class="btn" id="import-sample">시험용 가상 데이터 12명 넣기</button></div>' +
        '<p id="import-msg" class="muted" role="status"></p>' +
        '<p class="muted">시험이 끝나면 관리자가 Supabase SQL Editor에서 시험 데이터를 지울 수 있습니다(supabase/README.md).</p></section>' : '') +
      '</div>';

    document.getElementById('backup').onclick = downloadBackup;
    document.getElementById('reload').onclick = function () {
      S.reload().then(function () { toast('다시 불러왔습니다.'); renderDataRemote(); }, function (e) { toast(e.message); });
    };
    if (!canImport) return;
    var msg = document.getElementById('import-msg');
    function run(obj, label) {
      ask(label + '을(를) 서버에 추가합니다. 이용자 ' + obj.persons.length + '명.', '추가', function () {
        msg.textContent = '옮기는 중…';
        S.importToServer(obj, function (step) { msg.textContent = '옮기는 중… ' + step; }).then(function (r) {
          msg.textContent = '완료: 이용자 ' + r.persons + '명, 기록 ' + r.records + '건' + (r.errors.length ? ' · 문제 ' + r.errors.length + '건: ' + r.errors.slice(0, 3).join(' / ') : '');
          toast('서버로 옮겼습니다.');
        }, function (e) { msg.textContent = '옮기지 못했습니다. ' + e.message; });
      });
    }
    document.getElementById('import-sample').onclick = function () { run(window.PPP_SAMPLE(), '시험용 가상 데이터'); };
    document.getElementById('import-file').onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { msg.textContent = '파일이 너무 큽니다(20MB 초과).'; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var obj;
        try { obj = JSON.parse(String(reader.result)); } catch (er) { msg.textContent = 'JSON 형식이 올바르지 않습니다.'; return; }
        var check = S.validateBackup(obj);
        if (!check.ok) { msg.textContent = '파일 검사 실패: ' + check.errors.join(' / '); return; }
        run(obj, '백업 파일');
      };
      reader.readAsText(f, 'utf-8');
      e.target.value = '';
    };
  }

  function renderData() {
    if (S.isRemote()) { renderDataRemote(); return; }
    var c = S.counts();
    $main.innerHTML = '<div class="page-head"><div><span class="eyebrow">DATA</span><h1>데이터 관리</h1><p>백업·복원과 샘플 데이터를 관리합니다.</p></div></div>' +
      '<div class="notice danger"><strong>중요:</strong> 현재 시제품은 데이터를 <strong>이 브라우저(기기)에만</strong> 저장합니다. 다른 PC와 자동 동기화되지 않고, 암호화·사용자별 권한 관리가 없으며, 브라우저 데이터 삭제 시 함께 지워집니다. 실제 이용자 정보 입력 전 서버 DB·로그인 도입이 필요합니다(SECURITY.md 참고).</div>' +
      (S.isStorageOk() ? '' : '<div class="notice danger">브라우저 저장소를 사용할 수 없습니다(사생활 보호 모드 등). 새로고침하면 입력 내용이 사라집니다. 지금 백업 파일로 내려받으세요.</div>') +
      '<div class="stack">' +
      '<section class="card"><h2>현재 저장된 데이터</h2><div class="table-wrap"><table class="data-table compact"><tbody>' +
      [['이용자', c.persons], ['초기접수', c.intakes], ['목표', c.goals], ['프로그램 이용', c.programs], ['상담·회의', c.consultations], ['평가', c.evaluations]].map(function (r) {
        return '<tr><th scope="row">' + r[0] + '</th><td class="num">' + r[1] + '건</td></tr>';
      }).join('') + '</tbody></table></div></section>' +
      '<section class="card"><h2>백업 내려받기</h2><p>전체 데이터를 JSON 파일로 저장합니다. 백업 파일에는 이용자 정보가 들어 있으므로 기관이 정한 보안 저장소에만 보관하세요.</p>' +
      '<button type="button" class="btn primary" id="backup">백업 파일 내려받기</button></section>' +
      '<section class="card"><h2>백업에서 복원</h2><p>복원하면 현재 데이터가 <strong>모두 백업 파일 내용으로 바뀝니다.</strong> 파일 구조를 먼저 검사하고, 문제가 있으면 복원하지 않습니다.</p>' +
      '<div class="row-actions"><label class="btn" for="restore-file">파일 선택…</label><input type="file" id="restore-file" accept="application/json,.json" class="sr-only"><span id="restore-msg" class="muted" role="status"></span></div></section>' +
      '<section class="card"><h2>샘플·초기화</h2><p>가상 샘플 데이터는 기능 확인용입니다. 실제 이용자 정보가 아닙니다.</p><div class="row-actions">' +
      '<button type="button" class="btn" id="load-sample">가상 샘플 데이터 다시 불러오기</button>' +
      '<button type="button" class="btn danger" id="clear-all">모든 데이터 지우기</button></div></section>' +
      '</div>';

    document.getElementById('backup').onclick = downloadBackup;
    document.getElementById('restore-file').onchange = function (e) {
      var f = e.target.files[0];
      var msg = document.getElementById('restore-msg');
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { msg.textContent = '파일이 너무 큽니다(20MB 초과).'; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        var parsed;
        try { parsed = JSON.parse(text); } catch (err) { msg.textContent = '복원 실패: JSON 형식이 올바르지 않습니다.'; return; }
        var check = S.validateBackup(parsed);
        if (!check.ok) { msg.textContent = '복원 실패: ' + check.errors.join(' / '); return; }
        ask('이용자 ' + parsed.persons.length + '명의 데이터로 현재 데이터를 모두 바꿉니다.', '복원', function () {
          var r = S.importJson(text);
          if (r.ok) { toast('복원했습니다.'); renderData(); }
          else msg.textContent = '복원 실패: ' + r.errors.join(' / ');
        }, function () { msg.textContent = '복원을 취소했습니다.'; });
      };
      reader.onerror = function () { msg.textContent = '파일을 읽지 못했습니다.'; };
      reader.readAsText(f, 'utf-8');
      e.target.value = '';
    };
    document.getElementById('load-sample').onclick = function () {
      ask('현재 데이터를 지우고 가상 샘플 데이터로 바꿉니다.', '샘플 불러오기', function () { S.resetToSample(); toast('샘플 데이터를 불러왔습니다.'); renderData(); });
    };
    document.getElementById('clear-all').onclick = function () {
      ask('모든 데이터를 지웁니다. 되돌릴 수 없습니다. 먼저 백업하셨나요?', '모두 지우기', function () { S.clearAll(); toast('모든 데이터를 지웠습니다.'); renderData(); });
    };
  }

  /* ---------- 입력 폼 ---------- */
  var FORMS = {
    persons: {
      title: '이용자', fields: [
        { name: 'name', label: '이름(또는 가명)', required: true, maxlength: 20, hint: '내부 관리용 최소 정보만 입력' },
        { name: 'code', label: '관리 코드', readonly: true },
        { name: 'gender', label: '성별', type: 'select', options: ['남', '여', '응답 안 함'] },
        { name: 'birthYM', label: '출생 연월', type: 'month', hint: '생년월일 대신 연월만 수집' },
        { name: 'disabilityType', label: '장애유형', type: 'select', options: ['지적장애', '자폐성장애', '기타', '미기재'] },
        { name: 'stage', label: '현재 단계', type: 'select', options: S.STAGES, required: true },
        { name: 'worker', label: '담당자', required: true, maxlength: 20 },
        { name: 'enrolledAt', label: '등록일', type: 'date', required: true, notFuture: true },
        { name: 'oneLine', label: '나를 한마디로', full: true, maxlength: 40 },
        { name: 'dream', label: '나의 꿈', type: 'textarea', full: true, maxlength: 300 },
        { name: 'strengths', label: '내가 잘하는 것', type: 'textarea', maxlength: 300 },
        { name: 'likes', label: '좋아하는 것', type: 'textarea', maxlength: 300 },
        { name: 'dislikes', label: '나를 어렵게 하는 것', type: 'textarea', maxlength: 300 },
        { name: 'comfort', label: '나를 편안하게 하는 방법', type: 'textarea', maxlength: 300 },
        { name: 'priorities', label: '희망 우선 영역 (최대 3개, 선택 순서 = 순위)', type: 'multi', options: S.DOMAINS, max: 3, full: true },
        { name: 'consent', label: '개인정보 수집·이용 동의서를 받았습니다.', type: 'checkbox', required: true, full: true }
      ]
    },
    intakes: {
      title: '초기접수', fields: [
        { name: 'date', label: '접수일', type: 'date', required: true, notFuture: true },
        { name: 'route', label: '접수 경로', type: 'select', options: S.INTAKE_ROUTES, required: true },
        { name: 'applicant', label: '신청자', type: 'select', options: ['당사자', '보호자', '당사자·보호자', '지원자'] },
        { name: 'needs', label: '욕구·주호소', type: 'textarea', required: true, full: true, maxlength: 1000, hint: '당사자의 표현을 우선 기록' },
        { name: 'interestDomains', label: '관심 영역', type: 'multi', options: S.DOMAINS, full: true },
        { name: 'notes', label: '비고', type: 'textarea', full: true, maxlength: 1000 }
      ]
    },
    goals: {
      title: '목표', fields: [
        { name: 'term', label: '구분', type: 'select', options: ['단기', '중장기'], required: true },
        { name: 'domain', label: '영역', type: 'select', options: S.DOMAINS, required: true },
        { name: 'text', label: '목표', required: true, full: true, maxlength: 200 },
        { name: 'plan', label: '실천계획', type: 'textarea', full: true, maxlength: 1000 },
        { name: 'startDate', label: '시작일', type: 'date', required: true },
        { name: 'endDate', label: '종료(예정)일', type: 'date', afterField: 'startDate' },
        { name: 'status', label: '상태', type: 'select', options: S.GOAL_STATUS, required: true },
        { name: 'priority', label: '우선순위', type: 'number', min: 1, max: 8 }
      ]
    },
    programs: {
      title: '프로그램 이용', fields: [
        { name: 'date', label: '일자', type: 'date', required: true, notFuture: true },
        { name: 'programName', label: '프로그램명', required: true, maxlength: 50, list: 'program-names' },
        { name: 'domain', label: '영역', type: 'select', options: S.DOMAINS, required: true },
        { name: 'hours', label: '시간(시간)', type: 'number', min: 0.5, max: 12, step: 0.5 },
        { name: 'attendance', label: '참여 여부', type: 'select', options: ['참여', '불참'], required: true },
        { name: 'satisfaction', label: '만족도', type: 'select', options: ['', '1', '2', '3', '4', '5'], hint: '당사자 응답 기준 5점' },
        { name: 'note', label: '관찰 내용', type: 'textarea', full: true, maxlength: 500 }
      ]
    },
    consultations: {
      title: '상담·회의', fields: [
        { name: 'date', label: '일자', type: 'date', required: true, notFuture: true },
        { name: 'type', label: '유형', type: 'select', options: S.CONSULT_TYPES, required: true },
        { name: 'participants', label: '참석자', full: true, maxlength: 100, hint: '예: 당사자, 보호자, 담당자 (연락처 등은 적지 마세요)' },
        { name: 'summary', label: '내용', type: 'textarea', required: true, full: true, maxlength: 2000 },
        { name: 'nextAction', label: '다음 할 일', full: true, maxlength: 200 }
      ]
    },
    evaluations: {
      title: '평가', fields: [
        { name: 'date', label: '평가일', type: 'date', required: true, notFuture: true },
        { name: 'period', label: '평가 주기', type: 'select', options: S.EVAL_PERIODS, required: true },
        { name: 'selfScore', label: '당사자 점수 (0~10)', type: 'number', min: 0, max: 10, required: true },
        { name: 'workerScore', label: '담당자 점수 (0~10)', type: 'number', min: 0, max: 10 },
        { name: 'achieved', label: '변화·성과', type: 'textarea', full: true, maxlength: 1000 },
        { name: 'adjust', label: '세부계획 조정', type: 'textarea', full: true, maxlength: 1000 }
      ]
    }
  };

  function personForm(p) {
    var me = S.me();
    var blank = { code: S.nextPersonCode(), stage: '준비', enrolledAt: today(), priorities: [] };
    if (me) blank.workerId = me.staffId;
    openForm('persons', p || blank, function (rec) {
      return Promise.resolve(S.upsert('persons', rec)).then(function (saved) {
        toast(p ? '이용자 정보를 수정했습니다.' : '새 책을 만들었습니다.' + (S.isRemote() ? ' 관리코드 ' + saved.code : ''));
        if (p) refreshView(); else { ui.chapter = 'intake'; location.hash = '#/person/' + encodeURIComponent(saved.id); }
      });
    }, !p);
  }

  function recordForm(col, p, rec) {
    var defaults = { date: today(), personId: p.id };
    if (col === 'goals') defaults = { personId: p.id, startDate: today(), status: '진행', term: '단기' };
    if (col === 'programs') defaults.attendance = '참여';
    if (col === 'evaluations') defaults.period = '분기';
    openForm(col, rec || defaults, function (r) {
      r.personId = p.id;
      return Promise.resolve(S.upsert(col, r)).then(function () {
        toast(rec ? '기록을 수정했습니다.' : '기록을 추가했습니다.');
        refreshView();
      });
    }, !rec);
  }

  function formSpec(col, isNew) {
    var spec = FORMS[col];
    if (col !== 'persons' || !S.isRemote()) return spec;
    var me = S.me();
    return Object.assign({}, spec, {
      fields: spec.fields.map(function (f) {
        if (f.name === 'worker') {
          var opts = S.staffOptions();
          // 담당자 역할은 본인만 담당자로 지정할 수 있다(RLS)
          if (me && me.role === 'worker') opts = opts.filter(function (o) { return o.value === me.staffId; });
          return { name: 'workerId', label: '담당자', type: 'select', options: opts, required: true };
        }
        if (f.name === 'code' && isNew) return Object.assign({}, f, { hint: '저장하면 서버가 자동으로 매깁니다' });
        return f;
      })
    });
  }

  function openForm(col, rec, onSave, isNew) {
    var spec = formSpec(col, isNew);
    var dlg = document.getElementById('modal');
    document.getElementById('modal-title').textContent = spec.title + (isNew ? ' 추가' : ' 수정');
    var body = document.getElementById('modal-body');
    var progNames = Array.from(new Set(S.list('programs').map(function (r) { return r.programName; }))).sort();
    body.innerHTML = spec.fields.map(function (f) { return fieldHtml(f, rec[f.name]); }).join('') +
      (col === 'programs' ? '<datalist id="program-names">' + progNames.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' : '');
    var err = document.getElementById('modal-error');
    err.hidden = true;

    // 다중 선택은 고른 순서를 순위로 기억한다
    var order = (rec.priorities || rec.interestDomains || []).slice();
    body.querySelectorAll('.checks[data-max]').forEach(function (box) {
      var max = +box.getAttribute('data-max');
      box.addEventListener('change', function (e) {
        var v = e.target.value;
        if (e.target.checked) {
          if (max && order.length >= max) { e.target.checked = false; showFieldError(box.closest('.field'), '최대 ' + max + '개까지 선택할 수 있습니다.'); return; }
          order.push(v);
        } else order = order.filter(function (x) { return x !== v; });
        clearFieldError(box.closest('.field'));
      });
    });

    var form = document.getElementById('modal-form');
    form.onsubmit = function (e) {
      e.preventDefault();
      var out = Object.assign({}, rec), firstBad = null, bad = 0;
      spec.fields.forEach(function (f) {
        var wrap = body.querySelector('[data-field="' + f.name + '"]');
        clearFieldError(wrap);
        var v, msg = '';
        if (f.type === 'multi') {
          var checked = Array.from(wrap.querySelectorAll('input:checked')).map(function (i) { return i.value; });
          v = order.filter(function (x) { return checked.indexOf(x) >= 0; });
          checked.forEach(function (x) { if (v.indexOf(x) < 0) v.push(x); });
        } else if (f.type === 'checkbox') {
          v = wrap.querySelector('input').checked;
          if (f.required && !v) msg = '확인이 필요합니다.';
        } else {
          var input = wrap.querySelector('.input');
          v = input.value.trim();
          if (f.required && !v) msg = '필수 입력 항목입니다.';
          else if (v && f.maxlength && v.length > f.maxlength) msg = f.maxlength + '자 이내로 입력하세요.';
          else if (v && f.type === 'date') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v))) msg = '올바른 날짜를 입력하세요.';
            else if (f.notFuture && v > today()) msg = '오늘 이후 날짜는 입력할 수 없습니다.';
            else if (f.afterField) {
              var other = body.querySelector('[data-field="' + f.afterField + '"] .input').value;
              if (other && v < other) msg = '시작일보다 빠를 수 없습니다.';
            }
          } else if (v && f.type === 'month') {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) msg = 'YYYY-MM 형식으로 입력하세요.';
            else if (v > today().slice(0, 7) || v < '1900-01') msg = '올바른 연월을 입력하세요.';
          } else if (v && f.type === 'number') {
            var n = Number(v);
            if (isNaN(n)) msg = '숫자를 입력하세요.';
            else if (f.min != null && n < f.min) msg = f.min + ' 이상이어야 합니다.';
            else if (f.max != null && n > f.max) msg = f.max + ' 이하여야 합니다.';
            else v = n;
          }
        }
        if (msg) { bad++; showFieldError(wrap, msg); firstBad = firstBad || wrap; }
        if (!f.readonly) out[f.name] = v;
      });
      if (bad) {
        err.textContent = '입력값을 확인해 주세요. (' + bad + '개 항목)';
        err.hidden = false;
        var fi = firstBad.querySelector('input, select, textarea');
        if (fi) fi.focus();
        return;
      }
      var btn = document.getElementById('modal-submit');
      btn.disabled = true;
      btn.textContent = '저장 중…';
      // 서버 저장이 끝난 뒤에 창을 닫고, 실패하면 입력 내용을 그대로 둔 채 이유를 보여 준다
      Promise.resolve().then(function () { return onSave(out); }).then(function () {
        dlg.close();
      }, function (e) {
        err.textContent = '저장하지 못했습니다. ' + ((e && e.message) || e);
        err.hidden = false;
      }).then(function () { btn.disabled = false; btn.textContent = '저장'; });
    };
    dlg.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { dlg.close(); }; });
    dlg.showModal();
    var first = body.querySelector('input:not([readonly]), select, textarea');
    if (first) first.focus();
  }

  function fieldHtml(f, value) {
    var id = 'fld-' + f.name;
    var cls = 'field' + (f.full || f.type === 'textarea' && f.full ? ' full' : '');
    var req = f.required ? '<span class="req" aria-hidden="true">*</span>' : '';
    var hint = f.hint ? '<span class="hint" id="' + id + '-hint">' + esc(f.hint) + '</span>' : '';
    var aria = (f.required ? ' aria-required="true"' : '') + (f.hint ? ' aria-describedby="' + id + '-hint"' : '');
    var v = value == null ? '' : value;
    if (f.type === 'multi') {
      var sel = Array.isArray(v) ? v : [];
      return '<div class="' + cls + '" data-field="' + f.name + '"><fieldset><legend>' + esc(f.label) + req + '</legend><div class="checks"' + (f.max ? ' data-max="' + f.max + '"' : ' data-max="0"') + '>' +
        f.options.map(function (o) { return '<label><input type="checkbox" value="' + esc(o) + '"' + (sel.indexOf(o) >= 0 ? ' checked' : '') + '>' + esc(o) + '</label>'; }).join('') +
        '</div></fieldset>' + hint + '</div>';
    }
    if (f.type === 'checkbox') {
      return '<div class="' + cls + '" data-field="' + f.name + '"><div class="checks"><label><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + aria + '>' + esc(f.label) + req + '</label></div>' + hint + '</div>';
    }
    var control;
    if (f.type === 'select') {
      control = '<select class="input" id="' + id + '"' + aria + '>' + (f.required ? '' : (f.options[0] === '' ? '' : '<option value="">선택 안 함</option>')) +
        f.options.map(function (o) {
          var val = typeof o === 'object' ? o.value : o, lab = typeof o === 'object' ? o.label : o;
          return '<option value="' + esc(val) + '"' + (String(v) === val ? ' selected' : '') + '>' + (val === '' ? '선택 안 함' : esc(lab)) + '</option>';
        }).join('') + '</select>';
    } else if (f.type === 'textarea') {
      control = '<textarea class="input" id="' + id + '"' + aria + (f.maxlength ? ' maxlength="' + f.maxlength + '"' : '') + '>' + esc(v) + '</textarea>';
    } else {
      var type = f.type || 'text';
      control = '<input class="input" id="' + id + '" type="' + type + '" value="' + esc(v) + '"' + aria +
        (f.readonly ? ' readonly' : '') + (f.maxlength ? ' maxlength="' + f.maxlength + '"' : '') +
        (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.step ? ' step="' + f.step + '"' : '') +
        (f.list ? ' list="' + f.list + '"' : '') + (type === 'month' ? ' placeholder="YYYY-MM"' : '') + '>';
    }
    return '<div class="' + cls + '" data-field="' + f.name + '"><label for="' + id + '">' + esc(f.label) + req + '</label>' + control + hint + '</div>';
  }

  function showFieldError(wrap, msg) {
    wrap.classList.add('invalid');
    var e = wrap.querySelector('.err');
    if (!e) { e = document.createElement('span'); e.className = 'err'; wrap.appendChild(e); }
    e.textContent = msg;
    var input = wrap.querySelector('input, select, textarea');
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function clearFieldError(wrap) {
    wrap.classList.remove('invalid');
    var e = wrap.querySelector('.err');
    if (e) e.remove();
    var input = wrap.querySelector('[aria-invalid]');
    if (input) input.removeAttribute('aria-invalid');
  }

  /* ---------- 글자 크기 ---------- */
  function applyFont(i) {
    i = Math.max(0, Math.min(FONT_STEPS.length - 1, i));
    document.documentElement.style.fontSize = FONT_STEPS[i] + 'px';
    setPref('font', String(i));
    return i;
  }
  var fontIdx = applyFont(+pref('font', '1'));
  document.querySelectorAll('[data-font]').forEach(function (b) {
    b.onclick = function () {
      var d = +b.getAttribute('data-font');
      fontIdx = applyFont(d === 0 ? 1 : fontIdx + d);
      toast('글자 크기 ' + FONT_STEPS[fontIdx] + 'px');
    };
  });

  window.PPPApp = {
    MONITOR_DAYS: MONITOR_DAYS, CHAPTERS: CHAPTERS, esc: esc, today: today, fmtDate: fmtDate, daysBetween: daysBetween,
    stageBadge: stageBadge, personStats: personStats, chapterHtml: chapterHtml,
    bindChapterActions: bindChapterActions, drawPersonCharts: drawPersonCharts
  };

  /* ---------- 시작 ---------- */
  var banner = document.getElementById('banner');
  var started = false;

  function start(res) {
    if (res.mode === 'local' && res.loaded === 'sample') {
      banner.hidden = false;
      banner.textContent = '가상 샘플 데이터로 시작했습니다. 실제 이용자 정보가 아닙니다. 데이터는 이 브라우저에만 저장됩니다.';
    }
    if (res.state !== 'ready') { renderGate(res); return; }
    renderUserBox(res.me);
    started = true;
    route();
  }

  /* 로그인 전·직원 명단에 없음·연결 오류 화면 */
  function renderGate(res) {
    document.querySelector('.main-nav').hidden = true;
    var html = '<div class="gate"><div class="card gate-card"><span class="eyebrow">PPP 이야기 서재</span>';
    if (res.state === 'signedOut') {
      var authErr = res.authError || authErrorFromUrl();
      if (authErr) html += '<div class="notice danger" role="alert">' + esc(authErr) + '</div>';
      var google = window.PPP_CONFIG && window.PPP_CONFIG.googleLogin;
      html += '<h1>로그인</h1><p>기관에서 직원으로 등록한 이메일을 넣으면 로그인 링크를 보내 드립니다. 메일의 링크를 이 브라우저에서 열면 로그인됩니다.</p>' +
        '<form id="login-email" class="gate-form" novalidate><label for="login-email-input" class="sr-only">이메일</label>' +
        '<input id="login-email-input" class="input" type="email" autocomplete="email" placeholder="name@기관도메인" required>' +
        '<button type="submit" class="btn primary">로그인 링크 받기</button></form><p id="login-msg" class="muted" role="status"></p>' +
        (google ? '<div class="gate-or"><span>또는</span></div><button type="button" class="btn gate-btn" id="login-google">Google 계정으로 로그인</button>' : '') +
        '<p class="muted">등록되지 않은 이메일은 로그인해도 기록을 볼 수 없습니다.</p>';
    } else if (res.state === 'notStaff') {
      html += '<h1>직원 등록이 필요합니다</h1><p><strong>' + esc(res.email || '') + '</strong> 계정은 아직 직원 명단에 없거나 사용이 중지되었습니다.</p>' +
        '<p>관리자에게 이 이메일로 직원 등록을 요청하세요. 등록 후 다시 로그인하면 바로 사용할 수 있습니다.</p>' +
        '<button type="button" class="btn" id="logout">다른 계정으로 로그인</button>';
    } else {
      html += '<h1>서버에 연결하지 못했습니다</h1><p>' + esc(res.message || '') + '</p>' +
        '<button type="button" class="btn primary" id="retry">다시 시도</button>';
    }
    $main.innerHTML = html + '</div></div>';
    var g = document.getElementById('login-google');
    if (g) g.onclick = function () {
      S.signInGoogle().catch(function (e) { document.getElementById('login-msg').textContent = e.message; });
    };
    var f = document.getElementById('login-email');
    if (f) f.onsubmit = function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email-input').value.trim().toLowerCase();
      var msg = document.getElementById('login-msg');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = '이메일 주소를 확인하세요.'; return; }
      msg.textContent = '보내는 중…';
      S.signInEmail(email).then(function () {
        msg.textContent = email + ' 으로 로그인 링크를 보냈습니다. 메일의 링크를 이 브라우저에서 여세요.';
      }, function (er) { msg.textContent = '보내지 못했습니다. ' + er.message; });
    };
    var lo = document.getElementById('logout');
    if (lo) lo.onclick = function () { S.signOut().then(function () { location.reload(); }); };
    var rt = document.getElementById('retry');
    if (rt) rt.onclick = function () { location.reload(); };
  }

  /* 로그인 링크에서 돌아왔는데 로그인되지 않았을 때, 주소에 담긴 이유를 알려 준다 */
  function authErrorFromUrl() {
    var params = {};
    [location.search.slice(1), location.hash.replace(/^#\/?/, '')].forEach(function (part) {
      part.split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) { try { params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* 무시 */ } }
      });
    });
    var msg = '';
    if (params.error_code === 'otp_expired') msg = '로그인 링크가 만료되었거나 이미 사용되었습니다. 링크를 새로 받아 바로 눌러 주세요.';
    else if (params.error_description || params.error) msg = '로그인하지 못했습니다: ' + (params.error_description || params.error);
    else if (params.code) msg = '링크를 요청한 브라우저와 다른 곳에서 링크를 연 것 같습니다. 이 브라우저에서 링크를 새로 받아, 같은 브라우저로 메일의 링크를 열어 주세요.';
    if (msg) history.replaceState(null, '', location.pathname);
    return msg;
  }

  var ROLE_LABEL = { admin: '관리자', manager: '팀장', worker: '담당자' };
  function renderUserBox(me) {
    var box = document.getElementById('user-box');
    if (!me || !box) return;
    box.hidden = false;
    box.innerHTML = '<span class="user-name">' + esc(me.name) + ' <small>' + esc(ROLE_LABEL[me.role] || me.role) + '</small></span>' +
      '<button type="button" id="logout-btn">로그아웃</button>';
    document.getElementById('logout-btn').onclick = function () {
      S.signOut().then(function () { location.hash = '#/'; location.reload(); });
    };
  }

  $main.innerHTML = '<div class="empty"><strong>불러오는 중…</strong></div>';
  S.init().then(start, function (e) { start({ state: 'error', message: e.message }); });

  window.addEventListener('hashchange', function () {
    if (!started) return;
    var wasVillage = window.Village && window.Village.isMounted();
    route();
    // 마을 안에서 집·방을 옮길 때는 3D 화면 초점을 빼앗지 않는다
    if (!(wasVillage && window.Village.isMounted())) {
      $main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  });
})();
