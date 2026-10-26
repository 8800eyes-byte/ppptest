/* 저장소 계층 — 현재는 브라우저 localStorage 구현.
 * 서버 DB로 전환할 때는 이 파일의 load/save만 API 호출로 교체한다. (DATA_MODEL.md 참고)
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ppp.data.v1';
  var SCHEMA_VERSION = 1;

  var STAGES = ['준비', '계획', '실천', '평가'];
  var DOMAINS = ['교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정'];
  var CONSULT_TYPES = ['초기상담', '준비상담', '사전회의', '통합회의', '컨퍼런스회의', '확정회의', '모니터링상담', '수시상담'];
  var GOAL_STATUS = ['진행', '달성', '조정', '중단'];
  var EVAL_PERIODS = ['월', '분기', '반기', '연간'];
  var INTAKE_ROUTES = ['아카데미 수료', '직접 신청', '기관 의뢰', '기타'];
  var COLLECTIONS = ['persons', 'intakes', 'goals', 'programs', 'consultations', 'evaluations'];

  function emptyData() {
    return { schemaVersion: SCHEMA_VERSION, persons: [], intakes: [], goals: [], programs: [], consultations: [], evaluations: [] };
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nowIso() { return new Date().toISOString(); }

  var data = emptyData();
  var storageOk = true;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var check = validateBackup(parsed);
        if (check.ok) { data = parsed; return 'loaded'; }
      }
    } catch (e) {
      storageOk = false;
    }
    data = window.PPP_SAMPLE ? window.PPP_SAMPLE() : emptyData();
    save();
    return 'sample';
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    return storageOk;
  }

  function list(col, personId) {
    var arr = data[col] || [];
    return personId ? arr.filter(function (r) { return r.personId === personId; }) : arr.slice();
  }

  function get(col, id) {
    return (data[col] || []).find(function (r) { return r.id === id; }) || null;
  }

  function upsert(col, record) {
    var arr = data[col];
    var t = nowIso();
    if (record.id) {
      var i = arr.findIndex(function (r) { return r.id === record.id; });
      if (i >= 0) {
        arr[i] = Object.assign({}, arr[i], record, { updatedAt: t });
        save();
        return arr[i];
      }
    }
    var rec = Object.assign({}, record, { id: record.id || uid(col.slice(0, 3)), createdAt: t, updatedAt: t });
    arr.push(rec);
    save();
    return rec;
  }

  function remove(col, id) {
    data[col] = data[col].filter(function (r) { return r.id !== id; });
    if (col === 'persons') {
      COLLECTIONS.forEach(function (c) {
        if (c !== 'persons') data[c] = data[c].filter(function (r) { return r.personId !== id; });
      });
    }
    save();
  }

  function nextPersonCode() {
    var year = new Date().getFullYear();
    var max = 0;
    data.persons.forEach(function (p) {
      var m = /^P-(\d{4})-(\d{3})$/.exec(p.code || '');
      if (m && +m[1] === year) max = Math.max(max, +m[2]);
    });
    return 'P-' + year + '-' + String(max + 1).padStart(3, '0');
  }

  /* 백업 파일 구조 검증 — 복원 전에 반드시 통과해야 한다. */
  function validateBackup(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['JSON 객체가 아닙니다.'] };
    if (obj.schemaVersion !== SCHEMA_VERSION) errors.push('지원하지 않는 데이터 버전입니다. (schemaVersion: ' + obj.schemaVersion + ')');
    COLLECTIONS.forEach(function (c) {
      if (!Array.isArray(obj[c])) errors.push('"' + c + '" 항목이 없거나 배열이 아닙니다.');
    });
    if (errors.length) return { ok: false, errors: errors };
    var ids = {};
    obj.persons.forEach(function (p, i) {
      if (!p.id || !p.name) errors.push('이용자 ' + (i + 1) + '번째 기록에 id 또는 이름이 없습니다.');
      if (STAGES.indexOf(p.stage) < 0) errors.push('이용자 "' + (p.name || i) + '"의 단계 값이 올바르지 않습니다.');
      ids[p.id] = true;
    });
    COLLECTIONS.slice(1).forEach(function (c) {
      obj[c].forEach(function (r) {
        if (!r.id) errors.push(c + ' 기록에 id가 없습니다.');
        else if (!ids[r.personId]) errors.push(c + ' 기록(' + r.id + ')이 존재하지 않는 이용자를 가리킵니다.');
      });
    });
    return { ok: errors.length === 0, errors: errors.slice(0, 10) };
  }

  function exportJson() {
    return JSON.stringify(Object.assign({}, data, { exportedAt: nowIso() }), null, 2);
  }

  function importJson(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, errors: ['JSON 형식이 올바르지 않습니다.'] }; }
    var check = validateBackup(obj);
    if (!check.ok) return check;
    delete obj.exportedAt;
    data = obj;
    save();
    return { ok: true, counts: counts() };
  }

  function counts() {
    var c = {};
    COLLECTIONS.forEach(function (k) { c[k] = data[k].length; });
    return c;
  }

  function resetToSample() {
    data = window.PPP_SAMPLE();
    save();
  }

  function clearAll() {
    data = emptyData();
    save();
  }

  window.Store = {
    STAGES: STAGES, DOMAINS: DOMAINS, CONSULT_TYPES: CONSULT_TYPES, GOAL_STATUS: GOAL_STATUS,
    EVAL_PERIODS: EVAL_PERIODS, INTAKE_ROUTES: INTAKE_ROUTES, COLLECTIONS: COLLECTIONS,
    load: load, list: list, get: get, upsert: upsert, remove: remove,
    nextPersonCode: nextPersonCode, exportJson: exportJson, importJson: importJson,
    validateBackup: validateBackup, counts: counts, resetToSample: resetToSample, clearAll: clearAll,
    isStorageOk: function () { return storageOk; },
    // 브라우저 저장 모드: 로그인 없이 바로 시작. remote-store.js가 있으면 아래를 서버용으로 바꾼다
    init: function () { return Promise.resolve({ state: 'ready', mode: 'local', loaded: load() }); },
    isRemote: function () { return false; },
    me: function () { return null; }
  };
})();
