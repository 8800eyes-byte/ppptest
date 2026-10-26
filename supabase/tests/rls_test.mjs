// RLS 검증 — Supabase 없이 PGlite(브라우저·Node용 Postgres)에 Supabase의 auth 구조를 흉내 내어 schema.sql을 시험한다.
// 실행: npm i @electric-sql/pglite@0.2.17 && node supabase/tests/rls_test.mjs
// 가상 계정만 사용한다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const schema = readFileSync(here + '../schema.sql', 'utf8');
const db = new PGlite();

// Supabase가 기본으로 갖고 있는 것들의 최소 흉내
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase는 public의 새 테이블을 anon·authenticated에 기본으로 열어 둔다: 같은 조건에서 시험
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
await db.exec(schema);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? ' — ' + detail : '')); }
}
async function as(user, fn) {
  await db.exec('reset role');
  if (user === 'anon') await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  else await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function rows(sql, params) { return (await db.query(sql, params)).rows; }
async function denied(sql, params) {
  try { const r = await db.query(sql, params); return { ok: false, affected: r.affectedRows }; }
  catch (e) { return { ok: true, msg: e.message }; }
}
// 예상치 못한 오류는 짧게 보여 주고 끝낸다
process.on('unhandledRejection', e => { console.log('\n예상치 못한 오류: ' + e.message); process.exit(1); });

// 계정 준비 (관리 권한으로)
const users = {};
for (const [k, email, confirmed] of [
  ['admin', 'admin@example.org', true], ['mgr', 'mgr@example.org', true], ['w1', 'w1@example.org', true],
  ['w2', 'w2@example.org', true], ['stranger', 'stranger@example.org', true], ['unverified', 'w3@example.org', false]
]) {
  users[k] = (await rows(`insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`, [email, confirmed ? new Date() : null]))[0].id;
}
await db.exec(`
  insert into public.staff (email, name, role) values
    ('admin@example.org', '관리자', 'admin'), ('mgr@example.org', '팀장', 'manager'),
    ('w1@example.org', '담당1', 'worker'), ('w2@example.org', '담당2', 'worker'), ('w3@example.org', '담당3', 'worker');
`);
const staff = Object.fromEntries((await rows(`select email, id, user_id from public.staff`)).map(r => [r.email, r]));

console.log('\n[계정 연결]');
check('이메일 인증된 계정은 직원 명단과 자동 연결', staff['w1@example.org'].user_id === users.w1);
check('이메일 미인증 계정은 연결되지 않음', staff['w3@example.org'].user_id === null);

// 이용자 2명 (담당1, 담당2)
const base = `(name, stage, worker_id, enrolled_at, consent)`;
const p1 = (await rows(`insert into public.persons ${base} values ('가온', '실천', $1, '2026-03-01', true) returning id, code`, [staff['w1@example.org'].id]))[0];
const p2 = (await rows(`insert into public.persons ${base} values ('나래', '계획', $1, '2026-03-02', true) returning id, code`, [staff['w2@example.org'].id]))[0];
await rows(`insert into public.consultations (person_id, date, type, summary) values ($1, '2026-10-01', '모니터링상담', 'p1 상담'), ($2, '2026-10-02', '모니터링상담', 'p2 상담')`, [p1.id, p2.id]);

console.log('\n[관리코드]');
check('관리코드 자동 부여', p1.code === 'P-2026-001' && p2.code === 'P-2026-002', p1.code + ', ' + p2.code);

console.log('\n[비로그인 anon]');
await as('anon', async () => {
  for (const t of ['staff', 'persons', 'consultations', 'audit_logs']) {
    const r = await denied(`select * from public.${t}`);
    check(`anon은 ${t} 조회 불가`, r.ok, r.msg);
  }
  const r = await denied(`insert into public.persons ${base} values ('침입', '준비', $1, '2026-01-01', true)`, [staff['w1@example.org'].id]);
  check('anon은 이용자 추가 불가', r.ok);
});

console.log('\n[직원 명단에 없는 로그인 계정]');
await as(users.stranger, async () => {
  check('이용자 0명으로 보임', (await rows(`select * from public.persons`)).length === 0);
  check('상담 0건으로 보임', (await rows(`select * from public.consultations`)).length === 0);
  check('직원 명단 0명으로 보임', (await rows(`select * from public.staff`)).length === 0);
  const r = await denied(`insert into public.persons ${base} values ('x', '준비', $1, '2026-01-01', true)`, [staff['w1@example.org'].id]);
  check('이용자 추가 불가', r.ok);
});

console.log('\n[담당자 w1]');
await as(users.w1, async () => {
  const ps = await rows(`select name from public.persons`);
  check('자기 담당 이용자만 보임', ps.length === 1 && ps[0].name === '가온', JSON.stringify(ps));
  const cs = await rows(`select summary from public.consultations`);
  check('자기 담당 이용자의 상담만 보임', cs.length === 1 && cs[0].summary === 'p1 상담');
  check('직원 명단은 본인만 보임', (await rows(`select * from public.staff`)).length === 1);
  check('변경기록 조회 불가(0건)', (await rows(`select * from public.audit_logs`)).length === 0);

  let r = await denied(`insert into public.consultations (person_id, date, type, summary) values ($1, '2026-10-03', '수시상담', '남의 이용자')`, [p2.id]);
  check('남의 이용자에게 상담 추가 불가', r.ok);
  r = await denied(`update public.persons set stage = '평가' where id = $1`, [p2.id]);
  check('남의 이용자 수정 불가(0건)', !r.ok && r.affected === 0);
  r = await denied(`update public.persons set worker_id = $1 where id = $2`, [staff['w2@example.org'].id, p1.id]);
  check('담당자를 다른 직원으로 넘길 수 없음', r.ok);
  r = await denied(`insert into public.persons ${base} values ('남의 담당', '준비', $1, '2026-01-01', true)`, [staff['w2@example.org'].id]);
  check('다른 직원 담당으로 이용자 등록 불가', r.ok);
  r = await denied(`update public.staff set role = 'admin' where user_id = $1`, [users.w1]);
  check('자기 권한을 관리자로 올릴 수 없음(0건)', !r.ok && r.affected === 0);
  r = await denied(`delete from public.consultations where person_id = $1`, [p1.id]);
  check('영구 삭제 불가(0건)', !r.ok && r.affected === 0);
  r = await denied(`update public.consultations set created_by = $1 where person_id = $2`, [users.w2, p1.id]);
  const cb = (await rows(`select created_by from public.consultations where person_id = $1`, [p1.id]))[0];
  check('작성자(created_by)는 바꿀 수 없음', cb.created_by !== users.w2);

  const mine = (await rows(`insert into public.persons ${base} values ('다온', '준비', $1, '2026-05-01', true) returning id, code, created_by`, [staff['w1@example.org'].id]))[0];
  check('자기 담당으로 이용자 등록 가능 + 코드 자동', mine.code === 'P-2026-003');
  check('작성자는 서버가 기록', mine.created_by === users.w1);
  await rows(`insert into public.consultations (person_id, date, type, summary) values ($1, '2026-10-05', '초기상담', '새 상담')`, [mine.id]);
  const newId = (await rows(`select id from public.consultations where summary = '새 상담'`))[0].id;
  r = await denied(`update public.consultations set deleted_at = now() where id = $1`, [newId]);
  check('deleted_at 직접 수정 불가(보관은 전용 함수로만)', r.ok);
  await rows(`select public.archive_record('consultations', $1)`, [newId]);
  check('archive_record로 보관 후 보이지 않음', (await rows(`select * from public.consultations where id = $1`, [newId])).length === 0);
  r = await denied(`update public.consultations set deleted_at = null where id = $1`, [newId]);
  check('보관 처리한 기록을 되살릴 수 없음(관리자만)', !r.ok && r.affected === 0);
  const p2c = (await db.query(`reset role`), await rows(`select id from public.consultations where person_id = $1`, [p2.id]))[0].id;
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${users.w1}', false);`);
  r = await denied(`select public.archive_record('consultations', $1)`, [p2c]);
  check('남의 이용자 기록은 보관 처리 불가', r.ok);
  r = await denied(`select public.archive_record('staff', $1)`, [newId]);
  check('허용되지 않은 표는 보관 함수 거부', r.ok);
});

console.log('\n[입력값 제약]');
await as(users.w1, async () => {
  const w = staff['w1@example.org'].id;
  let r = await denied(`insert into public.persons ${base} values ('x', '종결', $1, '2026-01-01', true)`, [w]);
  check('없는 단계 값 거부', r.ok);
  r = await denied(`insert into public.persons ${base} values ('x', '준비', $1, '2026-01-01', false)`, [w]);
  check('동의 없이 등록 거부', r.ok);
  r = await denied(`insert into public.persons (name, stage, worker_id, enrolled_at, consent, priorities) values ('x', '준비', $1, '2026-01-01', true, array['교육','주거','직업','문화여가'])`, [w]);
  check('우선 영역 4개 거부', r.ok);
  r = await denied(`insert into public.evaluations (person_id, date, period, self_score) values ($1, '2026-10-01', '분기', 11)`, [p1.id]);
  check('평가 점수 11 거부', r.ok);
  r = await denied(`insert into public.goals (person_id, term, domain, text, start_date, end_date, status) values ($1, '단기', '교육', '목표', '2026-05-01', '2026-04-01', '진행')`, [p1.id]);
  check('종료일 < 시작일 거부', r.ok);
});

console.log('\n[팀장 mgr]');
await as(users.mgr, async () => {
  check('전체 이용자 보임(보관 제외)', (await rows(`select * from public.persons`)).length === 3);
  check('전체 직원 보임', (await rows(`select * from public.staff`)).length === 5);
  const r1 = await rows(`update public.persons set worker_id = $1 where id = $2 returning id`, [staff['w2@example.org'].id, p1.id]);
  check('담당자 변경 가능', r1.length === 1);
  await rows(`update public.persons set worker_id = $1 where id = $2`, [staff['w1@example.org'].id, p1.id]);
  let r = await denied(`insert into public.staff (email, name, role) values ('new@example.org', '신규', 'worker')`);
  check('직원 추가 불가(관리자만)', r.ok);
  r = await denied(`delete from public.persons where id = $1`, [p2.id]);
  check('이용자 영구 삭제 불가(0건)', !r.ok && r.affected === 0);
  check('변경기록 조회 불가(0건)', (await rows(`select * from public.audit_logs`)).length === 0);
});

console.log('\n[직원 비활성화]');
await db.exec(`update public.staff set active = false where email = 'w2@example.org'`);
await as(users.w2, async () => {
  check('비활성 직원은 아무것도 못 봄', (await rows(`select * from public.persons`)).length === 0);
});

console.log('\n[관리자 admin]');
await as(users.admin, async () => {
  const logs = await rows(`select action, table_name from public.audit_logs`);
  check('변경기록 조회 가능', logs.length > 0, String(logs.length));
  check('보관 처리된 기록도 보임', (await rows(`select * from public.consultations where deleted_at is not null`)).length === 1);
  const restored = await rows(`update public.consultations set deleted_at = null where deleted_at is not null returning id`);
  check('보관 처리된 기록 복구 가능', restored.length === 1);
  const r = await denied(`update public.audit_logs set action = 'X'`);
  check('변경기록 수정 불가', r.ok || r.affected === 0);
  const d = await rows(`delete from public.persons where id = $1 returning id`, [p2.id]);
  check('이용자 영구 삭제 가능(기록도 함께)', d.length === 1 && (await rows(`select * from public.consultations where person_id = $1`, [p2.id])).length === 0);
  await rows(`insert into public.staff (email, name, role) values ('new@example.org', '신규', 'worker')`);
  check('직원 추가 가능', (await rows(`select * from public.staff where email = 'new@example.org'`)).length === 1);
});

console.log('\n[RLS 켜짐 확인]');
const rls = await rows(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
check('public의 모든 테이블 RLS + FORCE', rls.every(r => r.relrowsecurity && r.relforcerowsecurity), JSON.stringify(rls.filter(r => !r.relrowsecurity || !r.relforcerowsecurity)));

console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
process.exit(fail ? 1 : 0);
