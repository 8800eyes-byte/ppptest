/* PPP 마을 — 3D 대시보드 (three.js r128)
 * 마을 = 전체 이용자, 집 = 이용자 1명, 집 안의 방 = 기록의 각 장.
 * 집·방 선택은 화면 위 목록 버튼으로도 할 수 있어 마우스 없이도 쓸 수 있다.
 */
(function () {
  'use strict';

  var T = window.THREE;
  var S = window.Store;
  var A; // window.PPPApp — app.js가 제공하는 공용 함수
  var st = null;

  var RECENT_DAYS = 14;
  var WALLS = ['#f4efe4', '#efe4d2', '#e6ecf3', '#f2e6df', '#eef0e4'];
  var ROOFS = ['#1f3766', '#3d5a91', '#8a5a3c', '#5d6f98', '#a07a26', '#6b4f7a'];
  var STAGE_HEX = { '준비': '#2a78d6', '계획': '#6250d6', '실천': '#1baf7a', '평가': '#eb6834' };
  var GROUND = '#d6e3c3';

  var ROOMS = [
    { id: 'intake', name: '현관', chapters: ['intake'], col: 0, row: 0, floor: '#d9c4a0' },
    { id: 'summary', name: '거실', chapters: ['summary'], col: 1, row: 0, floor: '#e4d3b4' },
    { id: 'goals', name: '꿈의 방', chapters: ['goals'], col: 2, row: 0, floor: '#d8d2e6' },
    { id: 'program', name: '활동실', chapters: ['program'], col: 0, row: 1, floor: '#cfdcc8' },
    { id: 'consult', name: '상담실', chapters: ['consult'], col: 1, row: 1, floor: '#e8d9c2' },
    { id: 'eval', name: '추억의 방', chapters: ['eval', 'timeline'], col: 2, row: 1, floor: '#e6d0c4' }
  ];
  var ROOM_OF_CHAPTER = { timeline: 'eval' };

  /* ---------- 유틸 ---------- */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mat(color, extra) { return new T.MeshLambertMaterial(Object.assign({ color: color }, extra || {})); }
  function mesh(geo, color, extra) {
    var m = new T.Mesh(geo, typeof color === 'string' ? mat(color, extra) : color);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function box(w, h, d, color, x, y, z, parent) {
    var m = mesh(new T.BoxGeometry(w, h, d), color);
    m.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(m);
    return m;
  }
  function mix(a, b, t) { return '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString(); }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function supported() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
    catch (e) { return false; }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* 글자 표지판(스프라이트) */
  function label(lines, o) {
    o = o || {};
    var c = document.createElement('canvas'), ctx = c.getContext('2d');
    var fs = 46, sub = 30, pad = 22;
    var f1 = '700 ' + fs + 'px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    var f2 = '500 ' + sub + 'px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.font = f1;
    var w = ctx.measureText(lines[0]).width;
    if (lines[1]) { ctx.font = f2; w = Math.max(w, ctx.measureText(lines[1]).width); }
    c.width = Math.ceil(w + pad * 2);
    c.height = Math.ceil(fs + (lines[1] ? sub + 12 : 0) + pad * 2 - 6);
    ctx.fillStyle = o.bg || 'rgba(255,253,248,0.95)';
    roundRect(ctx, 0, 0, c.width, c.height, 20); ctx.fill();
    ctx.strokeStyle = o.border || 'rgba(15,29,58,0.18)'; ctx.lineWidth = 4;
    roundRect(ctx, 2, 2, c.width - 4, c.height - 4, 18); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = f1; ctx.fillStyle = o.color || '#0f1d3a'; ctx.fillText(lines[0], c.width / 2, pad - 4);
    if (lines[1]) { ctx.font = f2; ctx.fillStyle = o.sub || '#4a5163'; ctx.fillText(lines[1], c.width / 2, pad - 4 + fs + 10); }
    var tex = new T.CanvasTexture(c);
    tex.minFilter = T.LinearFilter;
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    var h = o.h || 1.1;
    sp.scale.set(h * c.width / c.height, h, 1);
    sp.renderOrder = 2;
    return sp;
  }

  function disposeTree(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  /* ---------- 마운트 ---------- */
  function mount(main) {
    A = window.PPPApp;
    main.classList.add('village-mode');
    if (!T || !supported()) {
      main.innerHTML = '<div class="v-fallback"><div class="empty"><strong>이 기기에서는 3D 마을을 표시할 수 없습니다.</strong>' +
        (T ? '브라우저의 하드웨어 가속(WebGL)이 꺼져 있을 수 있습니다.' : '3D 그래픽 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.') +
        '<br><br><a class="btn primary" href="#/library">서재(책)로 보기</a></div></div>';
      return false;
    }
    main.innerHTML = template();
    var canvas = main.querySelector('#v-canvas');
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    st = {
      root: main.querySelector('#village'), canvas: canvas, renderer: renderer,
      camera: new T.PerspectiveCamera(42, 1, 0.5, 900),
      view: { target: new T.Vector3(), r: 60, theta: 0.35, phi: 0.95 },
      anim: null, mode: 'village', personId: null, room: null,
      hover: null, raycaster: new T.Raycaster(), pointer: new T.Vector2(),
      smoke: [], spin: [], clock: new T.Clock(), raf: 0, dirty: false
    };
    st.village = new T.Scene();
    st.interior = new T.Scene();
    [st.village, st.interior].forEach(function (sc) {
      sc.background = new T.Color('#dfeaf3');
      sc.add(new T.HemisphereLight('#ffffff', '#9aa58a', 0.6));
    });
    st.village.fog = new T.Fog('#dfeaf3', 160, 420);

    buildVillage();
    // 글꼴이 늦게 도착하면 표지판 글자를 다시 그린다
    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(function () { if (st && st.mode === 'village') buildVillage(); });
    }
    bindUi();
    st.onWinResize = fitHeight;
    window.addEventListener('resize', fitHeight);
    fitHeight();
    resize();
    st.ro = new ResizeObserver(resize);
    st.ro.observe(st.root);
    loop();
    return true;
  }

  function unmount() {
    if (!st) return;
    cancelAnimationFrame(st.raf);
    st.ro.disconnect();
    window.removeEventListener('keydown', st.onKey);
    window.removeEventListener('resize', st.onWinResize);
    disposeTree(st.village); disposeTree(st.interior);
    st.renderer.dispose();
    if (st.renderer.forceContextLoss) st.renderer.forceContextLoss();
    st = null;
  }

  function isMounted() { return !!st; }

  function template() {
    return '<div class="village" id="village">' +
      '<canvas id="v-canvas" tabindex="0" aria-label="3D 마을. 방향키로 이동, 더하기·빼기 키로 확대·축소, Q와 E 키로 회전합니다. 집은 왼쪽 집 목록에서도 고를 수 있습니다."></canvas>' +
      '<div class="v-fade" aria-hidden="true"></div>' +
      // 마을 HUD
      '<div class="v-layer" id="v-hud-village">' +
      '<section class="v-card v-stats" aria-label="마을 현황"><div class="v-title"><span class="eyebrow">PPP VILLAGE</span><h1>PPP 마을</h1></div><div class="v-stat-row" id="v-stats"></div></section>' +
      '<section class="v-card v-list" aria-label="집 목록">' +
      '<button type="button" class="v-list-toggle" id="v-list-toggle" aria-expanded="false" aria-controls="v-list-body">🏠 집 목록 <span id="v-count"></span></button>' +
      '<div id="v-list-body" hidden><label class="sr-only" for="v-search">이름·코드 검색</label><input id="v-search" class="input" type="search" placeholder="이름, 코드로 찾기">' +
      '<div id="v-list-items" class="v-list-items"></div></div></section>' +
      '<details class="v-card v-legend"><summary>마을 읽는 법</summary><ul>' +
      '<li><b>구역</b> 입구부터 준비 → 계획 → 실천 → 평가 마을</li>' +
      '<li><b>굴뚝 연기</b> 최근 ' + RECENT_DAYS + '일 안에 활동 기록 있음</li>' +
      '<li><b>노란 깃발 · ‘확인 필요’ 표지</b> 실천 단계인데 모니터링 상담이 ' + A.MONITOR_DAYS + '일 넘게 없음</li>' +
      '<li><b>마당의 꽃</b> 달성한 목표 수</li></ul></details>' +
      '</div>' +
      // 집 안 HUD
      '<div class="v-layer" id="v-hud-house" hidden>' +
      '<section class="v-card v-house-bar"><div class="v-house-head"><button type="button" class="btn small" id="v-back">← 마을로</button>' +
      '<div class="v-house-name" id="v-house-name"></div><a class="btn small" id="v-to-book" href="#">책으로 보기</a></div>' +
      '<div class="v-rooms" id="v-rooms" role="group" aria-label="방 고르기"></div></section>' +
      '<aside class="v-panel" id="v-panel" hidden aria-labelledby="v-panel-title"><header class="v-panel-head"><h2 id="v-panel-title"></h2>' +
      '<button type="button" class="icon-btn" id="v-panel-close" aria-label="방 나가기">✕</button></header><div class="v-panel-body" id="v-panel-body"></div></aside>' +
      '</div>' +
      '<div class="v-card v-ctrl" role="group" aria-label="시점 조절">' +
      '<button type="button" data-cam="rotl" aria-label="왼쪽으로 돌기">⟲</button><button type="button" data-cam="rotr" aria-label="오른쪽으로 돌기">⟳</button>' +
      '<button type="button" data-cam="in" aria-label="가까이">＋</button><button type="button" data-cam="out" aria-label="멀리">−</button>' +
      '<button type="button" data-cam="home" aria-label="처음 시점">⌂</button></div>' +
      '<div class="v-tip" id="v-tip" hidden></div>' +
      '</div>';
  }

  /* ---------- 마을 만들기 ---------- */
  function buildVillage() {
    var sc = st.village;
    if (st.villageGroup) { sc.remove(st.villageGroup); disposeTree(st.villageGroup); }
    var g = new T.Group();
    st.villageGroup = g;
    st.houses = [];
    st.smoke = [];
    sc.add(g);

    var persons = S.list('persons');
    var stats = {};
    persons.forEach(function (p) { stats[p.id] = A.personStats(p); });
    st.stats = stats;

    var x = 0, districts = [];
    S.STAGES.forEach(function (stage) {
      var list = persons.filter(function (p) { return p.stage === stage; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      var cols = Math.max(1, Math.ceil(list.length / 4));
      var len = cols * 9 + 10;
      districts.push({ stage: stage, list: list, x0: x, len: len });
      x += len + 4;
    });
    var total = x - 4;
    st.bounds = { x0: -14, x1: total + 6 };

    // 땅·길
    var ground = mesh(new T.PlaneGeometry(total + 400, 400), GROUND);
    ground.rotation.x = -Math.PI / 2; ground.position.set(total / 2, -0.02, 0); ground.castShadow = false;
    g.add(ground);
    var road = mesh(new T.PlaneGeometry(total + 24, 5), '#e9dcc0');
    road.rotation.x = -Math.PI / 2; road.position.set(total / 2 - 4, 0.01, 0); road.castShadow = false;
    g.add(road);

    // 입구 아치
    var gate = new T.Group();
    box(0.6, 6, 0.6, '#8a5a3c', 0, 3, -3.6, gate); box(0.6, 6, 0.6, '#8a5a3c', 0, 3, 3.6, gate);
    box(0.8, 0.8, 8.4, '#16294f', 0, 6.2, 0, gate);
    var gl = label(['PPP 마을', '평생과정설계 이용자 ' + persons.length + '명'], { h: 2.2, bg: 'rgba(22,41,79,0.95)', color: '#ffffff', sub: '#dcc48a', border: '#b8923a' });
    gl.position.set(0, 8.4, 0); gate.add(gl);
    gate.position.set(-8, 0, 0);
    g.add(gate);

    districts.forEach(function (d) {
      var tint = mix(GROUND, STAGE_HEX[d.stage], 0.22);
      var patch = mesh(new T.PlaneGeometry(d.len - 1, 44), tint);
      patch.rotation.x = -Math.PI / 2; patch.position.set(d.x0 + d.len / 2, 0, 0); patch.castShadow = false;
      g.add(patch);
      // 표지판
      var sign = new T.Group();
      box(0.3, 3.2, 0.3, '#8a5a3c', 0, 1.6, 0, sign);
      var sl = label([d.stage + ' 마을', d.list.length + '가구'], { h: 2.8, border: STAGE_HEX[d.stage] });
      sl.position.set(0, 4.8, 0); sign.add(sl);
      sign.position.set(d.x0 + 3, 0, 3.4);
      g.add(sign);
      d.list.forEach(function (p, i) {
        var col = Math.floor(i / 4), k = i % 4;
        var side = k % 2 ? 1 : -1;
        var depth = k < 2 ? 0 : 1;
        var hx = d.x0 + 9 + col * 9, hz = side * (9 + depth * 10);
        var house = makeHouse(p, stats[p.id]);
        house.position.set(hx, 0, hz);
        house.rotation.y = side > 0 ? Math.PI : 0;
        g.add(house);
        st.houses.push(house);
        // 집 앞 오솔길
        var lane = mesh(new T.PlaneGeometry(1.4, Math.abs(hz) - 4.6), '#e9dcc0');
        lane.rotation.x = -Math.PI / 2; lane.position.set(hx, 0.012, side * (2.5 + (Math.abs(hz) - 4.6) / 2)); lane.castShadow = false;
        g.add(lane);
      });
    });

    // 나무 (같은 자리에 매번 같은 모양)
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var t = 0; t < Math.max(16, total / 3); t++) {
      var tx = -10 + rnd() * (total + 20), tz = (rnd() < 0.5 ? -1 : 1) * (32 + rnd() * 20);
      g.add(makeTree(tx, tz, 0.8 + rnd() * 0.6));
    }

    // 조명·그림자
    if (st.sun) { sc.remove(st.sun); sc.remove(st.sun.target); }
    var sun = new T.DirectionalLight('#fff6e6', 0.62);
    sun.position.set(total / 2 - 30, 60, 40);
    sun.target.position.set(total / 2, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var half = Math.max(50, total / 2 + 20);
    sun.shadow.camera.left = -half; sun.shadow.camera.right = half;
    sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 200;
    sc.add(sun); sc.add(sun.target);
    st.sun = sun;

    st.home = { target: new T.Vector3(total / 2 - 4, 0, 0), r: Math.min(200, Math.max(44, total * 0.72)), theta: 0.35, phi: 0.95 };
    renderVillageHud(persons, stats);
  }

  function makeTree(x, z, s) {
    var g = new T.Group();
    var trunk = mesh(new T.CylinderGeometry(0.25, 0.35, 2, 6), '#8a5a3c'); trunk.position.y = 1; g.add(trunk);
    var top = mesh(new T.ConeGeometry(1.8, 3.6, 7), '#7fa37a'); top.position.y = 3.6; g.add(top);
    g.position.set(x, 0, z); g.scale.setScalar(s);
    return g;
  }

  function makeHouse(p, s) {
    var g = new T.Group();
    var h = hash(p.id);
    var wall = WALLS[h % WALLS.length], roof = ROOFS[(h >>> 4) % ROOFS.length];
    box(4.4, 3, 4, wall, 0, 1.5, 0, g);
    var roofM = mesh(new T.ConeGeometry(3.5, 2.3, 4), roof);
    roofM.position.y = 4.15; roofM.rotation.y = Math.PI / 4; g.add(roofM);
    box(0.5, 1.3, 0.5, '#8a5a3c', 1.1, 4.4, -0.7, g);
    box(1, 1.7, 0.1, '#16294f', 0, 0.85, 2.03, g);
    box(1.6, 0.15, 0.9, '#cbbd9f', 0, 0.07, 2.45, g);
    var winM = mat('#ffe7a3', { emissive: '#ffcf66', emissiveIntensity: 0.35 });
    [-1.45, 1.45].forEach(function (wx) { var w = mesh(new T.BoxGeometry(0.9, 0.9, 0.08), winM); w.position.set(wx, 1.9, 2.03); g.add(w); });

    // 우편함과 깃발: 모니터링 확인 필요
    box(0.12, 1, 0.12, '#5b4632', 2.6, 0.5, 3.2, g);
    box(0.7, 0.45, 0.45, '#3d5a91', 2.6, 1.15, 3.2, g);
    var flag = box(0.05, 0.4, 0.5, s.needsMonitor ? '#e0a526' : '#9aa0a8', 2.98, s.needsMonitor ? 1.55 : 1.05, 3.2, g);
    flag.castShadow = false;

    // 꽃: 달성한 목표 수
    var achieved = s.goals.filter(function (x) { return x.status === '달성'; }).length;
    var FLOWER = ['#e87ba4', '#eda100', '#ffffff', '#eb6834'];
    for (var k = 0; k < Math.min(8, achieved); k++) {
      var fl = mesh(new T.SphereGeometry(0.22, 8, 6), FLOWER[k % FLOWER.length]);
      fl.position.set(-2.4 + (k % 4) * 0.42, 0.35, 2.7 + Math.floor(k / 4) * 0.45); g.add(fl);
    }

    // 굴뚝 연기: 최근 활동
    var last = s.lastActivity ? A.daysBetween(s.lastActivity, A.today()) : 999;
    if (last <= RECENT_DAYS) {
      for (var q = 0; q < 3; q++) {
        var puff = new T.Mesh(new T.SphereGeometry(0.32, 8, 6), new T.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
        puff.position.set(1.1, 5.2, -0.7);
        puff.userData.phase = q / 3;
        g.add(puff);
        st.smoke.push(puff);
      }
    }

    var nl = label([p.name, p.code], { h: 2.3 });
    nl.position.set(0, 8.4, 0); g.add(nl);
    if (s.needsMonitor) {
      var ml = label(['! 확인 필요'], { h: 1.3, bg: 'rgba(246,239,220,0.97)', border: '#b8923a', color: '#7a5a14' });
      ml.position.set(0, 10.2, 0); g.add(ml);
    }

    // 클릭 판정용 투명 상자
    var hit = new T.Mesh(new T.BoxGeometry(5.2, 7.5, 6.4), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.set(0, 3.5, 0.8);
    hit.userData.pid = p.id;
    g.add(hit);
    g.userData = { pid: p.id, hit: hit };
    return g;
  }

  function renderVillageHud(persons, stats) {
    var thisMonth = A.today().slice(0, 7);
    var monthProg = S.list('programs').filter(function (r) { return r.date.slice(0, 7) === thisMonth && r.attendance === '참여'; }).length;
    var monthCons = S.list('consultations').filter(function (r) { return r.date.slice(0, 7) === thisMonth; }).length;
    var alerts = persons.filter(function (p) { return stats[p.id].needsMonitor; }).length;
    var el = st.root.querySelector('#v-stats');
    el.innerHTML = stat(persons.length + '명', '주민') + stat(monthProg + '회', '이번 달 참여') + stat(monthCons + '건', '이번 달 상담') +
      '<div class="v-stat' + (alerts ? ' warn' : '') + '"><b>' + alerts + '명</b><span>확인 필요</span></div>';
    st.root.querySelector('#v-count').textContent = '(' + persons.length + ')';
    renderList('');
  }

  function stat(v, l) { return '<div class="v-stat"><b>' + A.esc(v) + '</b><span>' + A.esc(l) + '</span></div>'; }

  function renderList(q) {
    q = (q || '').trim().toLowerCase();
    var box = st.root.querySelector('#v-list-items');
    var persons = S.list('persons');
    var html = S.STAGES.map(function (stage) {
      var list = persons.filter(function (p) {
        return p.stage === stage && (!q || (p.name + ' ' + p.code).toLowerCase().indexOf(q) >= 0);
      }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      if (!list.length) return '';
      return '<div class="v-list-group"><div class="v-list-stage">' + A.stageBadge(stage) + '</div>' + list.map(function (p) {
        var s = st.stats[p.id];
        return '<button type="button" class="v-house-btn" data-house="' + A.esc(p.id) + '"><span>' + A.esc(p.name) + ' <small>' + A.esc(p.code) + '</small></span>' +
          (s && s.needsMonitor ? '<em>확인 필요</em>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('');
    box.innerHTML = html || '<p class="muted">찾는 집이 없습니다.</p>';
  }

  /* ---------- 집 안 만들기 ---------- */
  function buildInterior(p) {
    var sc = st.interior;
    if (st.house) { sc.remove(st.house); disposeTree(st.house); }
    st.spin = [];
    var s = A.personStats(p);
    var g = new T.Group();
    st.house = g;
    st.roomGroups = {};
    sc.add(g);

    var grass = mesh(new T.PlaneGeometry(120, 120), GROUND);
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.3; grass.castShadow = false; g.add(grass);
    var h = hash(p.id), wall = WALLS[h % WALLS.length];
    box(22, 0.3, 15, '#bfae8f', 0, -0.15, 0, g);
    box(22, 3.2, 0.3, wall, 0, 1.6, -7.35, g); // 뒷벽
    box(0.3, 3.2, 15, wall, -10.95, 1.6, 0, g); // 왼쪽 벽
    box(0.3, 1.1, 15, wall, 10.95, 0.55, 0, g); // 오른쪽 낮은 벽
    // 방 사이 낮은 벽(가운데 문 틈)
    [-3.6, 3.6].forEach(function (x) {
      box(0.2, 1.1, 2.6, wall, x, 0.55, -5.6, g); box(0.2, 1.1, 2.6, wall, x, 0.55, -1.4, g);
      box(0.2, 1.1, 2.6, wall, x, 0.55, 1.4, g); box(0.2, 1.1, 2.6, wall, x, 0.55, 5.6, g);
    });
    [-7.2, 0, 7.2].forEach(function (x) { box(2.4, 1.1, 0.2, wall, x - 2.3, 0.55, 0, g); box(2.4, 1.1, 0.2, wall, x + 2.3, 0.55, 0, g); });

    var counts = {
      intake: S.list('intakes', p.id).length + '건', summary: '참여 ' + s.attended + '회',
      goals: s.goals.length + '개', program: s.attended + '회 참여',
      consult: s.consultations + '건', eval: s.evaluations.length + '건'
    };
    ROOMS.forEach(function (r) {
      var rg = new T.Group();
      rg.position.set((r.col - 1) * 7.2, 0, (r.row - 0.5) * 7.2);
      var floor = box(6.9, 0.1, 6.9, mat(r.floor, { emissive: '#b8923a', emissiveIntensity: 0 }), 0, 0.05, 0, rg);
      floor.castShadow = false;
      FURNISH[r.id](rg, p, s);
      var title = A.CHAPTERS.filter(function (c) { return c.id === r.chapters[0]; })[0].title;
      var lb = label([r.name, title + ' · ' + counts[r.id]], { h: 1.35 });
      lb.position.set(0, 3.6, 0); rg.add(lb);
      var hit = new T.Mesh(new T.BoxGeometry(6.9, 3, 6.9), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.y = 1.5; hit.userData.room = r.id; rg.add(hit);
      rg.userData = { room: r.id, floor: floor, hit: hit };
      st.roomGroups[r.id] = rg;
      g.add(rg);
    });

    var sun = new T.DirectionalLight('#fff6e6', 0.55);
    sun.position.set(-14, 30, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    g.add(sun);
  }

  var FURNISH = {
    intake: function (g, p) {
      box(1.4, 2.4, 0.2, '#16294f', -1.6, 1.2, -3.2, g); // 현관문
      box(1.8, 0.04, 1.1, '#b8923a', -1.6, 0.12, -2.4, g);
      box(0.12, 1.1, 0.12, '#5b4632', 1.6, 0.6, -1.8, g);
      box(0.9, 0.6, 0.6, '#3d5a91', 1.6, 1.4, -1.8, g);
      var n = Math.min(6, S.list('intakes', p.id).length);
      for (var i = 0; i < n; i++) box(0.8, 0.04, 0.55, '#ffffff', 1.6, 1.75 + i * 0.06, -1.8, g);
      box(2.2, 0.9, 0.7, '#a07a26', 1.2, 0.45, 2.4, g); // 신발장
    },
    summary: function (g, p, s) {
      box(3.2, 0.6, 1.2, '#3d5a91', 0, 0.4, 1.9, g); box(3.2, 0.9, 0.3, '#3d5a91', 0, 1, 2.45, g);
      box(1.6, 0.4, 0.9, '#a07a26', 0, 0.3, 0.2, g);
      box(3.4, 2, 0.15, '#16294f', 0, 1.9, -3.2, g); // 현황판
      var by = {};
      S.list('programs', p.id).forEach(function (r) { if (r.attendance === '참여') by[r.domain] = (by[r.domain] || 0) + 1; });
      var vals = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b - a; }).slice(0, 4);
      var max = Math.max.apply(null, vals.concat([1]));
      vals.forEach(function (v, i) {
        var hgt = 0.2 + 1.4 * v / max;
        var b = box(0.45, hgt, 0.08, '#dcc48a', -1.05 + i * 0.7, 1.0 + hgt / 2, -3.1, g);
        b.castShadow = false;
      });
    },
    goals: function (g, p, s) {
      box(2, 0.6, 3, '#e6ecf3', -1.6, 0.4, -1.2, g); box(1.6, 0.3, 0.7, '#ffffff', -1.6, 0.85, -2.3, g);
      var star = mesh(new T.OctahedronGeometry(0.7), mat('#e0a526', { emissive: '#b8923a', emissiveIntensity: 0.4 }));
      star.position.set(1.4, 2.3, -0.6); g.add(star); st.spin.push(star);
      var goals = s.goals.slice(0, 6);
      goals.forEach(function (x, i) {
        box(0.06, 0.9, 0.06, '#5b4632', 0.4 + (i % 3) * 0.8, 0.45, 1.6 + Math.floor(i / 3) * 0.9, g);
        box(0.45, 0.3, 0.04, x.status === '달성' ? '#1baf7a' : '#b8923a', 0.62 + (i % 3) * 0.8, 0.75, 1.6 + Math.floor(i / 3) * 0.9, g);
      });
    },
    program: function (g, p, s) {
      box(3.6, 0.15, 1.8, '#a07a26', 0, 1, -0.6, g);
      [[-1.6, -1.3], [1.6, -1.3], [-1.6, 0.1], [1.6, 0.1]].forEach(function (q) { box(0.15, 1, 0.15, '#5b4632', q[0], 0.5, q[1], g); });
      var COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#eda100'];
      var n = Math.min(15, s.attended);
      for (var i = 0; i < n; i++) box(0.5, 0.35, 0.5, COLORS[i % COLORS.length], 1.8 + (i % 3) * 0.55 - 0.55, 0.18 + Math.floor(i / 3) * 0.36, 2.2, g);
      box(0.1, 1.8, 1.2, '#5b4632', -2.4, 0.9, 2, g); box(0.05, 1.1, 1, '#ffffff', -2.33, 1.3, 2, g);
    },
    consult: function () {
      var g = arguments[0];
      var t = mesh(new T.CylinderGeometry(1.1, 1.1, 0.12, 20), '#a07a26'); t.position.set(0, 0.95, 0); g.add(t);
      var leg = mesh(new T.CylinderGeometry(0.12, 0.2, 0.9, 8), '#5b4632'); leg.position.set(0, 0.45, 0); g.add(leg);
      [0, 2.1, 4.2].forEach(function (a) {
        var c = new T.Group();
        box(0.8, 0.12, 0.8, '#3d5a91', 0, 0.55, 0, c); box(0.8, 0.8, 0.12, '#3d5a91', 0, 0.95, 0.4, c);
        c.position.set(Math.sin(a) * 1.9, 0, Math.cos(a) * 1.9); c.rotation.y = a; g.add(c);
      });
      var pot = mesh(new T.CylinderGeometry(0.35, 0.28, 0.6, 10), '#8a5a3c'); pot.position.set(2.4, 0.3, -2.4); g.add(pot);
      var leaf = mesh(new T.SphereGeometry(0.7, 10, 8), '#7fa37a'); leaf.position.set(2.4, 1.1, -2.4); g.add(leaf);
    },
    eval: function (g, p, s) {
      box(3.4, 2.6, 0.7, '#8a5a3c', 0, 1.3, -2.9, g);
      var ALB = ['#1f3766', '#b8923a', '#6250d6', '#1baf7a', '#eb6834'];
      var n = Math.min(12, s.evaluations.length);
      for (var i = 0; i < n; i++) box(0.22, 0.75, 0.5, ALB[i % ALB.length], -1.3 + (i % 6) * 0.35, 1.0 + Math.floor(i / 6) * 0.95, -2.75, g);
      if (s.goals.some(function (x) { return x.status === '달성'; })) {
        var cup = mesh(new T.CylinderGeometry(0.35, 0.18, 0.7, 12), mat('#e0a526', { emissive: '#b8923a', emissiveIntensity: 0.3 }));
        cup.position.set(1.8, 1.1, 1.2); g.add(cup);
        box(0.7, 0.75, 0.7, '#e6ecf3', 1.8, 0.38, 1.2, g);
      }
      box(1.6, 1.1, 0.08, '#ffffff', -1.6, 1.6, 2.6, g).rotation.x = -0.25;
    }
  };

  /* ---------- 화면 전환 ---------- */
  function navigate(personId, room) {
    if (!st) return;
    if (room && ROOM_OF_CHAPTER[room]) room = ROOM_OF_CHAPTER[room];
    if (!personId) { showVillage(); return; }
    var p = S.get('persons', personId);
    if (!p) { location.hash = '#/'; return; }
    if (st.mode !== 'interior' || st.personId !== personId) enterHouse(p, room);
    else selectRoom(room);
  }

  function showVillage() {
    var fromHouse = st.mode === 'interior' ? st.personId : null;
    closePanel(true);
    st.mode = 'village'; st.personId = null; st.room = null;
    if (st.dirty) { buildVillage(); st.dirty = false; }
    st.root.querySelector('#v-hud-village').hidden = false;
    st.root.querySelector('#v-hud-house').hidden = true;
    fade(function () {
      var house = fromHouse && st.houses.filter(function (h) { return h.userData.pid === fromHouse; })[0];
      if (house) {
        setView({ target: house.position.clone(), r: 16, theta: st.home.theta, phi: 0.9 });
        flyTo(st.home, 900);
      } else setView(st.home);
    });
    document.title = 'PPP 마을';
  }

  function enterHouse(p, room) {
    var house = st.mode === 'village' && st.houses.filter(function (h) { return h.userData.pid === p.id; })[0];
    var go = function () {
      fade(function () {
        st.mode = 'interior'; st.personId = p.id;
        buildInterior(p);
        renderHouseHud(p);
        st.root.querySelector('#v-hud-village').hidden = true;
        st.root.querySelector('#v-hud-house').hidden = false;
        setView({ target: new T.Vector3(0, 0, 0.5), r: 30, theta: 0.18, phi: 0.82 });
        st.room = null;
        if (room) selectRoom(room);
      });
    };
    if (house && !reducedMotion()) {
      flyTo({ target: house.position.clone().add(new T.Vector3(0, 2, 0)), r: 11, theta: house.rotation.y === 0 ? 0 : Math.PI, phi: 1.05 }, 650, go);
    } else go();
    document.title = p.name + '의 집 · PPP 마을';
  }

  function renderHouseHud(p) {
    var s = A.personStats(p);
    st.root.querySelector('#v-house-name').innerHTML = '<strong>' + A.esc(p.name) + '의 집</strong> <span class="muted">' + A.esc(p.code) + '</span> ' + A.stageBadge(p.stage) +
      (s.needsMonitor ? ' <span class="status s-조정">모니터링 확인 필요</span>' : '');
    st.root.querySelector('#v-to-book').href = '#/person/' + encodeURIComponent(p.id);
    st.root.querySelector('#v-rooms').innerHTML = ROOMS.map(function (r) {
      return '<button type="button" data-room="' + r.id + '" aria-pressed="' + (st.room === r.id) + '">' + A.esc(r.name) + '</button>';
    }).join('');
  }

  function selectRoom(room) {
    if (!room || !st.roomGroups || !st.roomGroups[room]) { closePanel(); return; }
    st.room = room;
    var r = ROOMS.filter(function (x) { return x.id === room; })[0];
    var p = S.get('persons', st.personId);
    st.root.querySelectorAll('#v-rooms [data-room]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-room') === room); });
    Object.keys(st.roomGroups).forEach(function (k) { st.roomGroups[k].userData.floor.material.emissiveIntensity = k === room ? 0.25 : 0; });
    var rg = st.roomGroups[room];
    var wide = st.root.clientWidth > 860;
    // 패널이 오른쪽을 가리므로 넓은 화면에서는 방을 화면 왼쪽으로 보낸다
    var target = rg.position.clone().add(new T.Vector3(wide ? 3.2 : 0, 0.5, wide ? 0 : 2.2));
    flyTo({ target: target, r: 21, theta: 0.18, phi: 0.82 }, 600);
    renderPanel(p, r);
  }

  function renderPanel(p, r) {
    var s = A.personStats(p);
    var panel = st.root.querySelector('#v-panel');
    st.root.querySelector('#v-panel-title').textContent = r.name;
    var body = st.root.querySelector('#v-panel-body');
    body.innerHTML = r.chapters.map(function (cid) {
      var c = A.CHAPTERS.filter(function (x) { return x.id === cid; })[0];
      return '<div class="chapter" id="ch-' + c.id + '">' + A.chapterHtml(c, p, s) + '</div>';
    }).join('');
    panel.hidden = false;
    st.root.classList.add('panel-open');
    A.bindChapterActions(body, p);
    if (r.chapters.indexOf('summary') >= 0) A.drawPersonCharts(p, s);
    body.scrollTop = 0;
  }

  function closePanel(silent) {
    if (!st) return;
    st.root.querySelector('#v-panel').hidden = true;
    st.root.classList.remove('panel-open');
    if (st.roomGroups) Object.keys(st.roomGroups).forEach(function (k) { st.roomGroups[k].userData.floor.material.emissiveIntensity = 0; });
    st.root.querySelectorAll('#v-rooms [data-room]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    if (!silent && st.mode === 'interior') {
      st.room = null;
      flyTo({ target: new T.Vector3(0, 0, 0.5), r: 30, theta: 0.18, phi: 0.82 }, 500);
    }
  }

  /* 기록 추가·수정·삭제 뒤 호출 — 장면을 새로 만들지 않고 집 안과 패널만 갱신 */
  function refresh() {
    if (!st) return false;
    st.dirty = true;
    if (st.mode === 'interior') {
      var p = S.get('persons', st.personId);
      if (!p) { location.hash = '#/'; return true; }
      buildInterior(p);
      renderHouseHud(p);
      if (st.room) {
        var room = st.room;
        st.roomGroups[room].userData.floor.material.emissiveIntensity = 0.25;
        renderPanel(p, ROOMS.filter(function (x) { return x.id === room; })[0]);
      }
    } else { buildVillage(); st.dirty = false; }
    return true;
  }

  function fade(fn) {
    var f = st.root.querySelector('.v-fade');
    if (reducedMotion()) { fn(); return; }
    f.classList.add('on');
    setTimeout(function () { if (!st) return; fn(); requestAnimationFrame(function () { if (st) f.classList.remove('on'); }); }, 180);
  }

  /* ---------- 카메라 ---------- */
  function setView(v) {
    st.anim = null;
    st.view.target.copy(v.target); st.view.r = v.r; st.view.theta = v.theta; st.view.phi = v.phi;
  }

  function flyTo(v, ms, done) {
    if (reducedMotion()) { setView(v); if (done) done(); return; }
    var dt = v.theta - st.view.theta;
    while (dt > Math.PI) dt -= Math.PI * 2;
    while (dt < -Math.PI) dt += Math.PI * 2;
    st.anim = {
      t0: performance.now(), ms: ms,
      from: { target: st.view.target.clone(), r: st.view.r, theta: st.view.theta, phi: st.view.phi },
      to: { target: v.target.clone(), r: v.r, theta: st.view.theta + dt, phi: v.phi },
      done: done
    };
  }

  function clampView() {
    var v = st.view;
    v.phi = Math.max(0.45, Math.min(1.25, v.phi));
    if (st.mode === 'village') {
      v.r = Math.max(10, Math.min(240, v.r));
      v.target.x = Math.max(st.bounds.x0, Math.min(st.bounds.x1, v.target.x));
      v.target.z = Math.max(-30, Math.min(30, v.target.z));
    } else {
      v.r = Math.max(8, Math.min(48, v.r));
      v.target.x = Math.max(-12, Math.min(12, v.target.x));
      v.target.z = Math.max(-9, Math.min(9, v.target.z));
    }
  }

  function updateCamera() {
    var v = st.view;
    if (st.anim) {
      var k = Math.min(1, (performance.now() - st.anim.t0) / st.anim.ms);
      var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      var a = st.anim.from, b = st.anim.to;
      v.target.lerpVectors(a.target, b.target, e);
      v.r = a.r + (b.r - a.r) * e; v.theta = a.theta + (b.theta - a.theta) * e; v.phi = a.phi + (b.phi - a.phi) * e;
      if (k >= 1) { var d = st.anim.done; st.anim = null; if (d) d(); }
    } else clampView();
    var c = st.camera;
    c.position.set(
      v.target.x + v.r * Math.sin(v.phi) * Math.sin(v.theta),
      v.target.y + v.r * Math.cos(v.phi),
      v.target.z + v.r * Math.sin(v.phi) * Math.cos(v.theta)
    );
    c.lookAt(v.target);
  }

  function pan(dx, dy) {
    var v = st.view, k = v.r * 0.0016;
    var rx = Math.cos(v.theta), rz = -Math.sin(v.theta); // 화면 오른쪽 방향(땅 위)
    var fx = -Math.sin(v.theta), fz = -Math.cos(v.theta); // 화면 위쪽(앞) 방향
    v.target.x += (-dx * rx + dy * fx) * k;
    v.target.z += (-dx * rz + dy * fz) * k;
    st.anim = null;
  }

  function camAction(a) {
    var v = st.view;
    var to = { target: v.target.clone(), r: v.r, theta: v.theta, phi: v.phi };
    if (a === 'rotl') to.theta -= Math.PI / 6;
    if (a === 'rotr') to.theta += Math.PI / 6;
    if (a === 'in') to.r *= 0.75;
    if (a === 'out') to.r /= 0.75;
    if (a === 'home') {
      if (st.mode === 'village') to = st.home;
      else to = { target: new T.Vector3(0, 0, 0.5), r: 30, theta: 0.18, phi: 0.82 };
    }
    flyTo(to, 400);
  }

  /* ---------- 입력 ---------- */
  function pick(e) {
    var rect = st.canvas.getBoundingClientRect();
    st.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    st.raycaster.setFromCamera(st.pointer, st.camera);
    if (st.mode === 'village') {
      var hits = st.raycaster.intersectObjects(st.houses.map(function (h) { return h.userData.hit; }), false);
      return hits[0] ? { pid: hits[0].object.userData.pid } : null;
    }
    var rh = st.raycaster.intersectObjects(Object.keys(st.roomGroups || {}).map(function (k) { return st.roomGroups[k].userData.hit; }), false);
    return rh[0] ? { room: rh[0].object.userData.room } : null;
  }

  function setHover(h, e) {
    var tip = st.root.querySelector('#v-tip');
    var key = h ? (h.pid || h.room) : null;
    if (st.hoverKey !== key) {
      if (st.hoverHouse) st.hoverHouse.scale.setScalar(1);
      if (st.hoverRoom && st.hoverRoom !== st.room && st.roomGroups && st.roomGroups[st.hoverRoom]) st.roomGroups[st.hoverRoom].userData.floor.material.emissiveIntensity = 0;
      st.hoverHouse = null; st.hoverRoom = null; st.hoverKey = key;
      if (h && h.pid) {
        st.hoverHouse = st.houses.filter(function (x) { return x.userData.pid === h.pid; })[0];
        if (st.hoverHouse) st.hoverHouse.scale.setScalar(1.06);
      }
      if (h && h.room && st.roomGroups[h.room] && h.room !== st.room) {
        st.hoverRoom = h.room;
        st.roomGroups[h.room].userData.floor.material.emissiveIntensity = 0.14;
      }
    }
    st.canvas.style.cursor = h ? 'pointer' : 'grab';
    if (!h || !e) { tip.hidden = true; return; }
    if (h.pid) {
      var p = S.get('persons', h.pid), s = st.stats[h.pid];
      tip.innerHTML = '<strong>' + A.esc(p.name) + '</strong> · ' + A.esc(p.stage) + '<br>프로그램 ' + s.attended + '회 · 상담 ' + s.consultations + '건<br>최근 활동 ' + A.fmtDate(s.lastActivity) +
        (s.needsMonitor ? '<br><b>모니터링 확인 필요</b>' : '') + '<br><span class="muted">눌러서 집에 들어가기</span>';
    } else {
      var r = ROOMS.filter(function (x) { return x.id === h.room; })[0];
      tip.innerHTML = '<strong>' + A.esc(r.name) + '</strong><br><span class="muted">눌러서 들어가기</span>';
    }
    tip.hidden = false;
    var rect = st.root.getBoundingClientRect();
    var x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 14;
    if (x + tip.offsetWidth > rect.width - 8) x = e.clientX - rect.left - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > rect.height - 8) y = e.clientY - rect.top - tip.offsetHeight - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  function bindUi() {
    var c = st.canvas, root = st.root;
    var pointers = {}, drag = null, pinch = null;

    c.addEventListener('pointerdown', function (e) {
      c.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: st.view.r };
        drag = null;
      } else {
        drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, rotate: e.button === 2 || e.shiftKey, moved: false };
      }
    });
    c.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) {
        var ids = Object.keys(pointers);
        if (ids.length === 2) {
          var a = pointers[ids[0]], b = pointers[ids[1]];
          st.view.r = pinch.r * pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
          st.anim = null;
        }
        return;
      }
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) drag.moved = true;
        if (drag.moved) {
          if (drag.rotate) { st.view.theta -= dx * 0.006; st.view.phi -= dy * 0.004; st.anim = null; }
          else pan(dx, dy);
          setHover(null);
          c.style.cursor = 'grabbing';
        }
        drag.x = e.clientX; drag.y = e.clientY;
        return;
      }
      if (e.pointerType === 'mouse') setHover(pick(e), e);
    });
    function end(e) {
      delete pointers[e.pointerId];
      if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; drag = null; return; }
      if (drag && !drag.moved) {
        var h = pick(e);
        if (h && h.pid) location.hash = '#/village/' + encodeURIComponent(h.pid);
        else if (h && h.room) location.hash = '#/village/' + encodeURIComponent(st.personId) + '/' + h.room;
      }
      drag = null;
      c.style.cursor = 'grab';
    }
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; drag = null; pinch = null; });
    c.addEventListener('pointerleave', function () { if (!drag) setHover(null); });
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      st.view.r *= Math.exp(e.deltaY * 0.001);
      st.anim = null;
    }, { passive: false });

    st.onKey = function (e) {
      if (!st || e.target.closest('input, textarea, select, dialog')) return;
      if (e.key === 'Escape') {
        if (st.mode === 'interior') {
          if (st.room) location.hash = '#/village/' + encodeURIComponent(st.personId);
          else location.hash = '#/';
        }
        return;
      }
      if (document.activeElement !== c) return;
      var step = 40;
      var map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (map[e.key]) { e.preventDefault(); pan(map[e.key][0], map[e.key][1]); }
      else if (e.key === '+' || e.key === '=') camAction('in');
      else if (e.key === '-') camAction('out');
      else if (e.key === 'q' || e.key === 'Q') camAction('rotl');
      else if (e.key === 'e' || e.key === 'E') camAction('rotr');
    };
    window.addEventListener('keydown', st.onKey);

    root.querySelectorAll('[data-cam]').forEach(function (b) { b.onclick = function () { camAction(b.getAttribute('data-cam')); }; });
    var tg = root.querySelector('#v-list-toggle');
    tg.onclick = function () {
      var body = root.querySelector('#v-list-body');
      body.hidden = !body.hidden;
      tg.setAttribute('aria-expanded', !body.hidden);
      if (!body.hidden) root.querySelector('#v-search').focus();
    };
    root.querySelector('#v-search').oninput = function (e) { renderList(e.target.value); };
    root.querySelector('#v-search').onkeydown = function (e) {
      if (e.key === 'Enter') { var b = root.querySelector('[data-house]'); if (b) b.click(); }
    };
    root.querySelector('#v-list-items').addEventListener('click', function (e) {
      var b = e.target.closest('[data-house]');
      if (b) location.hash = '#/village/' + encodeURIComponent(b.getAttribute('data-house'));
    });
    root.querySelector('#v-list-items').addEventListener('mouseover', function (e) {
      var b = e.target.closest('[data-house]');
      if (b && st.mode === 'village') setHover({ pid: b.getAttribute('data-house') });
    });
    root.querySelector('#v-back').onclick = function () { location.hash = '#/'; };
    root.querySelector('#v-rooms').addEventListener('click', function (e) {
      var b = e.target.closest('[data-room]');
      if (b) location.hash = '#/village/' + encodeURIComponent(st.personId) + '/' + b.getAttribute('data-room');
    });
    root.querySelector('#v-panel-close').onclick = function () { location.hash = '#/village/' + encodeURIComponent(st.personId); };
  }

  /* 헤더 아래 남은 화면 높이를 마을이 모두 쓴다 */
  function fitHeight() {
    if (!st) return;
    var top = st.root.getBoundingClientRect().top + window.scrollY;
    st.root.style.height = Math.max(440, window.innerHeight - top) + 'px';
  }

  function resize() {
    if (!st) return;
    var w = st.root.clientWidth, h = st.root.clientHeight;
    if (!w || !h) return;
    st.renderer.setSize(w, h, false);
    st.camera.aspect = w / h;
    st.camera.updateProjectionMatrix();
  }

  function loop() {
    if (!st) return;
    st.raf = requestAnimationFrame(loop);
    var t = st.clock.getElapsedTime();
    if (st.mode === 'village') {
      st.smoke.forEach(function (puff) {
        var k = (t * 0.35 + puff.userData.phase) % 1;
        puff.position.y = 5.2 + k * 2.6;
        puff.position.x = 1.1 + Math.sin(k * 6 + puff.userData.phase * 9) * 0.25;
        puff.scale.setScalar(0.6 + k * 1.2);
        puff.material.opacity = 0.75 * (1 - k);
      });
    } else st.spin.forEach(function (m) { m.rotation.y = t * 0.8; m.position.y = 2.3 + Math.sin(t * 1.6) * 0.15; });
    updateCamera();
    st.renderer.render(st.mode === 'village' ? st.village : st.interior, st.camera);
  }

  window.Village = { mount: mount, unmount: unmount, navigate: navigate, refresh: refresh, isMounted: isMounted };
})();
