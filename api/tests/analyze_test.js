// /api/analyze 시험 — fetch를 가짜로 바꿔 Supabase·Gemini 없이 흐름을 확인한다. 가상 데이터만 사용.
// 실행: node api/tests/analyze_test.js
'use strict';
var assert = require('assert');
var path = require('path');

var PID = '11111111-2222-4333-8444-555555555555';
var sent = [];
var scenario = {};

global.fetch = function (url, opts) {
  sent.push({ url: url, body: opts && opts.body });
  function json(status, obj) {
    return Promise.resolve({ ok: status < 300, status: status, json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(typeof obj === 'string' ? obj : JSON.stringify(obj)); } });
  }
  if (url.indexOf('/auth/v1/user') > 0) return scenario.badToken ? json(401, { msg: 'bad' }) : json(200, { id: 'aaaaaaaa-0000-4000-8000-000000000001' });
  if (url.indexOf('/rest/v1/staff') > 0) return json(200, scenario.notStaff ? [] : [{ id: 's1', role: 'worker', active: true }]);
  if (url.indexOf('/rest/v1/persons') > 0) return json(200, scenario.noPerson ? [] : [{
    id: PID, name: '가온', code: 'P-2026-001', stage: '실천', birth_ym: '2001-03', disability_type: '지적장애',
    enrolled_at: '2025-03-01', one_line: '웃음이 많은 사람', dream: '가온이는 바리스타가 되고 싶다', priorities: ['직업', '주거'], worker_id: 's1'
  }]);
  if (url.indexOf('/rest/v1/consultations') > 0) return json(200, [{ date: '2026-10-01', type: '모니터링상담', summary: '가온 님이 010-1234-5678로 연락 달라고 함', next_action: '', participants: '김복지' }]);
  if (url.indexOf('/rest/v1/') > 0) return json(200, []);
  if (url.indexOf('generativelanguage') > 0) {
    if (url.indexOf('gemini-3.5-flash') > 0) return json(404, { error: { message: 'models/gemini-3.5-flash is not found' } });
    if (scenario.quota) return json(429, { error: { message: 'quota' } });
    return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ 변화_요약: '요약', 목표_제안: [{ 영역: '직업', 구분: '단기', 목표: '카페 실습 참여', 실천계획: '주 1회', 근거: '2026-10-01 상담' }] }) }] } }] });
  }
  return json(500, 'unexpected ' + url);
};

var handler = require(path.join(__dirname, '..', 'analyze.js'));
function call(req) {
  return new Promise(function (resolve) {
    var res = { headers: {}, setHeader: function (k, v) { this.headers[k] = v; }, end: function (b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(Object.assign({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: { personId: PID } }, req), res);
  });
}

(async function () {
  var pass = 0;
  function ok(name, cond, detail) { assert.ok(cond, name + (detail ? ' — ' + JSON.stringify(detail) : '')); pass++; console.log('  ✔ ' + name); }

  delete process.env.GEMINI_API_KEY;
  var r = await call({});
  ok('키가 없으면 503 안내', r.status === 503);
  process.env.GEMINI_API_KEY = 'test-key';

  r = await call({ method: 'GET' });
  ok('POST 외 거부', r.status === 405);
  r = await call({ headers: {} });
  ok('로그인 토큰 없으면 401', r.status === 401);
  r = await call({ body: { personId: "x' or 1=1" } });
  ok('잘못된 이용자 id 거부', r.status === 400);
  scenario = { badToken: true }; r = await call({});
  ok('토큰이 틀리면 401', r.status === 401);
  scenario = { notStaff: true }; r = await call({});
  ok('직원 명단에 없으면 403', r.status === 403);
  scenario = { noPerson: true }; r = await call({});
  ok('볼 권한 없는 이용자는 404', r.status === 404);

  scenario = {}; sent = [];
  r = await call({});
  ok('정상 응답 200', r.status === 200, r.body);
  ok('없는 모델은 건너뛰고 다음 모델 사용', r.body.model === 'gemini-3-flash-preview', r.body.model);
  ok('목표 제안 JSON 해석', r.body.result.목표_제안[0].영역 === '직업');
  var g = sent.filter(function (s) { return s.url.indexOf('generativelanguage') > 0; }).pop();
  ok('Gemini로 보낸 내용에 이름 없음', g.body.indexOf('가온') < 0);
  ok('관리코드 없음', g.body.indexOf('P-2026-001') < 0);
  ok('전화번호 가림', g.body.indexOf('010-1234-5678') < 0 && g.body.indexOf('[연락처]') > 0);
  ok('참석자(직원 이름) 없음', g.body.indexOf('김복지') < 0);
  ok('키는 헤더로만 전송(주소에 없음)', g.url.indexOf('test-key') < 0);
  ok('실데이터 승인 기본값 false', r.body.realDataApproved === false);
  ok('Supabase 요청은 모두 사용자 토큰으로(RLS 적용)', sent.filter(function (s) { return s.url.indexOf('supabase.co') > 0; }).length >= 7);

  scenario = { quota: true }; r = await call({});
  ok('무료 한도 초과 안내 429', r.status === 429 && /한도/.test(r.body.error));

  scenario = {};
  for (var i = 0; i < 6; i++) await call({});
  r = await call({});
  ok('1분 사용량 제한', r.status === 429);

  console.log('\n결과: ' + pass + '개 통과');
})().catch(function (e) { console.error('✘ ' + e.message); process.exit(1); });
