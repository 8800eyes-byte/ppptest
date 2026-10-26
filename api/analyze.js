/* AI 분석 창구 (Vercel 서버 함수) — POST /api/analyze  { personId }
 *
 * 1) 요청한 사람의 Supabase 로그인 토큰을 확인하고, 활성 직원인지 본다.
 * 2) 그 사람의 토큰으로 기록을 읽는다 → DB의 RLS가 그대로 적용되어 볼 권한이 있는 기록만 읽힌다.
 * 3) 이름·관리코드·직원 정보·참석자 등은 빼고, 자유 서술 속 이름도 ‘당사자’로 바꿔 Gemini에 보낸다.
 * 4) 결과는 저장하지 않고 화면에 ‘초안’으로만 돌려준다.
 *
 * 환경 변수(Vercel → Settings → Environment Variables)
 *   GEMINI_API_KEY            필수, Secret
 *   GEMINI_MODEL              선택, 모델 이름을 고정할 때
 *   AI_REAL_DATA_APPROVED     선택, 'true'면 실제 이용자 데이터 사용 승인됨(유료 키 + 기관 승인 후에만)
 */
'use strict';

var SUPABASE_URL = process.env.SUPABASE_URL || 'https://kpwggxtrvzgqiaekatxc.supabase.co';
var SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_5_uCeOz_F1vBG7kNCpE0Lw_f79cES-n';
// 모델 이름이 자주 바뀌므로 차례로 시도한다. GEMINI_MODEL이 있으면 그것만 쓴다.
var MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 같은 서버 인스턴스 안에서의 간단한 사용량 제한(직원당 1분 6회)
var hits = {};
function limited(uid) {
  var now = Date.now();
  hits[uid] = (hits[uid] || []).filter(function (t) { return now - t < 60000; });
  if (hits[uid].length >= 6) return true;
  hits[uid].push(now);
  return false;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sb(path, token) {
  return fetch(SUPABASE_URL + path, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } })
    .then(function (r) {
      if (!r.ok) return r.text().then(function (t) { var e = new Error('supabase ' + r.status + ' ' + t.slice(0, 200)); e.status = r.status; throw e; });
      return r.json();
    });
}

function scrub(text, name) {
  if (text == null) return '';
  var s = String(text);
  if (name && name.length >= 2) s = s.split(name).join('당사자');
  // 기록에 섞여 들어갈 수 있는 전화번호·이메일 제거
  return s.replace(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[연락처]').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[이메일]');
}

function age(birthYM) {
  if (!birthYM) return null;
  var y = +birthYM.slice(0, 4);
  return isNaN(y) ? null : new Date().getFullYear() - y;
}

function buildInput(p, data) {
  var n = p.name;
  var progs = data.programs;
  var attended = progs.filter(function (r) { return r.attendance === '참여'; });
  var byDomain = {};
  attended.forEach(function (r) { byDomain[r.domain] = (byDomain[r.domain] || 0) + 1; });
  return {
    당사자: {
      단계: p.stage, 연령대: age(p.birth_ym) ? Math.floor(age(p.birth_ym) / 10) * 10 + '대' : '미기재',
      장애유형: p.disability_type || '미기재', 등록일: p.enrolled_at,
      나를_한마디로: scrub(p.one_line, n), 나의_꿈: scrub(p.dream, n), 잘하는_것: scrub(p.strengths, n),
      좋아하는_것: scrub(p.likes, n), 어렵게_하는_것: scrub(p.dislikes, n), 편안하게_하는_방법: scrub(p.comfort, n),
      희망_우선영역: p.priorities
    },
    초기접수: data.intakes.map(function (r) {
      return { 날짜: r.date, 경로: r.route, 욕구: scrub(r.needs, n), 관심영역: r.interest_domains, 비고: scrub(r.notes, n) };
    }),
    목표: data.goals.map(function (r) {
      return { 구분: r.term, 영역: r.domain, 목표: scrub(r.text, n), 실천계획: scrub(r.plan, n), 시작: r.start_date, 종료: r.end_date, 상태: r.status };
    }),
    프로그램_요약: {
      전체_기록: progs.length, 참여: attended.length,
      영역별_참여: byDomain,
      최근_관찰: progs.slice(-15).map(function (r) {
        return { 날짜: r.date, 프로그램: r.program_name, 영역: r.domain, 참여: r.attendance, 만족도: r.satisfaction, 관찰: scrub(r.note, n) };
      })
    },
    상담_회의: data.consultations.slice(-30).map(function (r) {
      return { 날짜: r.date, 유형: r.type, 내용: scrub(r.summary, n), 다음_할_일: scrub(r.next_action, n) };
    }),
    평가: data.evaluations.map(function (r) {
      return { 날짜: r.date, 주기: r.period, 당사자_점수: r.self_score, 담당자_점수: r.worker_score, 변화: scrub(r.achieved, n), 조정: scrub(r.adjust, n) };
    })
  };
}

var DOMAINS = ['교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정'];

var INSTRUCTION = [
  '당신은 종합사회복지관의 평생과정설계(PPP) 사업을 돕는 사례관리 보조자입니다.',
  'PPP는 장애 당사자가 준비 → 계획(지원회의) → 실천 → 평가 과정을 거치며 스스로 꿈과 목표를 정하는 사업입니다.',
  '아래 기록을 읽고 담당 사회복지사가 다음 지원회의를 준비할 수 있도록 초안을 만드세요.',
  '원칙:',
  '- 당사자의 자기결정권을 존중합니다. 목표는 “제안”이며, 당사자가 회의에서 직접 고르고 고칠 수 있게 쉬운 말로 씁니다.',
  '- 기록에 있는 내용만 근거로 씁니다. 기록에 없는 사실, 진단, 약물, 가족 사정을 지어내지 않습니다.',
  '- 각 항목에 근거가 된 기록의 날짜나 종류를 짧게 밝힙니다.',
  '- 결핍보다 강점과 바람을 먼저 봅니다. 낙인이 될 수 있는 표현을 쓰지 않습니다.',
  '- 영역은 다음 중에서만 고릅니다: ' + DOMAINS.join(', ') + '.',
  '- 기록이 부족하면 부족하다고 쓰고, 다음 상담에서 확인할 질문을 제안합니다.',
  '반드시 아래 JSON 형식으로만 답하세요(설명 문장 없이):',
  '{"변화_요약": "3~5문장", "강점": ["..."], "살펴볼_점": ["..."], "회의_논의거리": ["..."],',
  ' "목표_제안": [{"영역": "...", "구분": "단기 또는 중장기", "목표": "당사자가 이해하기 쉬운 한 문장", "실천계획": "...", "근거": "..."}],',
  ' "다음_상담_질문": ["..."], "기록_보완_제안": ["..."]}'
].join('\n');

function callGemini(key, input) {
  var models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : MODELS;
  var body = JSON.stringify({
    systemInstruction: { parts: [{ text: INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: '기록(이름 등 식별정보는 제거됨):\n' + JSON.stringify(input) }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json', maxOutputTokens: 4096 }
  });
  function attempt(i, lastErr) {
    if (i >= models.length) return Promise.reject(lastErr || new Error('사용할 수 있는 Gemini 모델이 없습니다.'));
    var model = models[i];
    return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body
    }).then(function (r) {
      return r.text().then(function (t) {
        if (r.status === 404 || (r.status === 400 && /not found|not supported/i.test(t))) return attempt(i + 1, new Error(model + ' 모델을 쓸 수 없습니다.'));
        if (r.status === 429) { var e = new Error('Gemini 무료 사용량 한도를 넘었습니다. 잠시 뒤 다시 시도하세요.'); e.status = 429; throw e; }
        if (!r.ok) { var e2 = new Error('Gemini 오류 ' + r.status + ': ' + t.slice(0, 200)); e2.status = 502; throw e2; }
        var j = JSON.parse(t);
        var text = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (p) { return p.text || ''; }).join('');
        var parsed = null;
        try { parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); } catch (err) { /* 형식이 어긋나면 원문을 돌려준다 */ }
        return { model: model, result: parsed, raw: parsed ? null : text };
      });
    });
  }
  return attempt(0);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST만 사용할 수 있습니다.' });
  var key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 503, { error: 'AI 키가 설정되지 않았습니다. Vercel 환경 변수에 GEMINI_API_KEY를 넣고 다시 배포하세요.' });

  var auth = req.headers.authorization || '';
  var token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  if (!token) return send(res, 401, { error: '로그인이 필요합니다.' });
  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  var personId = body && body.personId;
  if (!personId || !UUID.test(personId)) return send(res, 400, { error: '이용자 정보가 올바르지 않습니다.' });

  try {
    var user = await sb('/auth/v1/user', token);
    var staff = await sb('/rest/v1/staff?select=id,role,active&user_id=eq.' + user.id, token);
    if (!staff.length || !staff[0].active) return send(res, 403, { error: '직원 명단에 등록된 계정만 사용할 수 있습니다.' });
    if (limited(user.id)) return send(res, 429, { error: '잠시 뒤 다시 시도하세요(1분에 6회까지).' });

    var people = await sb('/rest/v1/persons?select=*&deleted_at=is.null&id=eq.' + personId, token);
    if (!people.length) return send(res, 404, { error: '이용자를 찾을 수 없거나 볼 권한이 없습니다.' });
    var q = '?select=*&deleted_at=is.null&order=date.asc&person_id=eq.' + personId;
    var data = {
      intakes: await sb('/rest/v1/intakes' + q, token),
      goals: await sb('/rest/v1/goals?select=*&deleted_at=is.null&order=start_date.asc&person_id=eq.' + personId, token),
      programs: await sb('/rest/v1/programs' + q, token),
      consultations: await sb('/rest/v1/consultations' + q, token),
      evaluations: await sb('/rest/v1/evaluations' + q, token)
    };
    var out = await callGemini(key, buildInput(people[0], data));
    return send(res, 200, {
      model: out.model, result: out.result, raw: out.raw,
      realDataApproved: process.env.AI_REAL_DATA_APPROVED === 'true',
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403) return send(res, 401, { error: '로그인이 만료되었습니다. 다시 로그인하세요.' });
    return send(res, e.status === 429 ? 429 : 502, { error: e.message || 'AI 분석 중 오류가 났습니다.' });
  }
};

module.exports.config = { maxDuration: 60 };
module.exports._test = { buildInput: buildInput, scrub: scrub };
