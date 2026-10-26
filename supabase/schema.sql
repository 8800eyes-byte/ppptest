-- =====================================================================
-- PPP 이야기 서재 — Supabase 스키마 (RLS 전체 적용)
--
-- 실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run (새 프로젝트에서 1회)
-- 마지막 부분의 '첫 관리자 등록' 이메일을 기관 관리자 이메일로 바꾼 뒤 실행하세요.
--
-- 보안 원칙
--   1) public 스키마의 모든 테이블에 RLS를 켜고(FORCE 포함) 정책이 허용한 것만 접근한다.
--   2) 로그인만으로는 아무것도 볼 수 없다. staff(직원 명단)에 등록되고 active인 계정만 접근한다.
--   3) 담당자(worker)는 자기가 담당하는 이용자와 그 기록만 보고 고친다.
--      팀장(manager)은 전체를 보고 고친다. 관리자(admin)만 직원 관리·영구 삭제·변경기록 조회를 한다.
--   4) 앱의 '삭제'는 deleted_at을 채우는 보관 처리(soft delete)다. 영구 삭제는 관리자만 가능하다.
--   5) 비로그인(anon) 역할은 어떤 테이블에도 권한이 없다.
--   6) 모든 추가·수정·삭제는 audit_logs에 자동 기록된다(관리자만 조회).
--
-- 선택지 값(단계·영역·상담 유형 등)은 js/store.js 상수와 같아야 한다. 바꿀 때는 둘 다 고친다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 내부 함수용 스키마 (API로 노출되지 않음)
-- ---------------------------------------------------------------------
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- ---------------------------------------------------------------------
-- 1. 직원 명단 (허용 목록)
-- ---------------------------------------------------------------------
create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(btrim(email)) and email like '%_@_%'),
  user_id     uuid unique references auth.users (id) on delete set null,
  name        text not null check (char_length(btrim(name)) between 1 and 20),
  role        text not null default 'worker' check (role in ('admin', 'manager', 'worker')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. 권한 판단 함수 (security definer: RLS 재귀를 피하고, search_path를 비워 주입을 막는다)
-- ---------------------------------------------------------------------
create function app_private.my_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s
  where s.user_id = auth.uid() and s.active
$$;

create function app_private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s
  where s.user_id = auth.uid() and s.active
$$;

create function app_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.my_role() is not null
$$;

create function app_private.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.my_role() in ('admin', 'manager'), false)
$$;

create function app_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.my_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------------
-- 3. 이용자
-- ---------------------------------------------------------------------
create table public.persons (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^P-[0-9]{4}-[0-9]{3,}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 20),
  gender           text check (gender in ('남', '여', '응답 안 함')),
  birth_ym         text check (birth_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  disability_type  text check (disability_type in ('지적장애', '자폐성장애', '기타', '미기재')),
  stage            text not null check (stage in ('준비', '계획', '실천', '평가')),
  worker_id        uuid not null references public.staff (id),
  enrolled_at      date not null,
  one_line         text check (char_length(one_line) <= 40),
  dream            text check (char_length(dream) <= 300),
  strengths        text check (char_length(strengths) <= 300),
  likes            text check (char_length(likes) <= 300),
  dislikes         text check (char_length(dislikes) <= 300),
  comfort          text check (char_length(comfort) <= 300),
  priorities       text[] not null default '{}' check (
                     cardinality(priorities) <= 3
                     and priorities <@ array['교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정']::text[]
                   ),
  consent          boolean not null check (consent),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz
);
create index persons_worker_idx on public.persons (worker_id) where deleted_at is null;
create index persons_stage_idx on public.persons (stage) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 4. 기록 5종 (모두 이용자에 속함)
-- ---------------------------------------------------------------------
create table public.intakes (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references public.persons (id) on delete cascade,
  date             date not null,
  route            text not null check (route in ('아카데미 수료', '직접 신청', '기관 의뢰', '기타')),
  applicant        text check (applicant in ('당사자', '보호자', '당사자·보호자', '지원자')),
  needs            text not null check (char_length(btrim(needs)) between 1 and 1000),
  interest_domains text[] not null default '{}' check (
                     interest_domains <@ array['교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정']::text[]
                   ),
  notes            text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.persons (id) on delete cascade,
  term        text not null check (term in ('단기', '중장기')),
  domain      text not null check (domain in ('교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정')),
  text        text not null check (char_length(btrim(text)) between 1 and 200),
  plan        text check (char_length(plan) <= 1000),
  start_date  date not null,
  end_date    date check (end_date >= start_date),
  status      text not null check (status in ('진행', '달성', '조정', '중단')),
  priority    smallint check (priority between 1 and 8),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table public.programs (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.persons (id) on delete cascade,
  date          date not null,
  program_name  text not null check (char_length(btrim(program_name)) between 1 and 50),
  domain        text not null check (domain in ('교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정')),
  hours         numeric(3, 1) check (hours between 0.5 and 12),
  attendance    text not null check (attendance in ('참여', '불참')),
  satisfaction  smallint check (satisfaction between 1 and 5),
  note          text check (char_length(note) <= 500),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table public.consultations (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.persons (id) on delete cascade,
  date          date not null,
  type          text not null check (type in ('초기상담', '준비상담', '사전회의', '통합회의', '컨퍼런스회의', '확정회의', '모니터링상담', '수시상담')),
  participants  text check (char_length(participants) <= 100),
  summary       text not null check (char_length(btrim(summary)) between 1 and 2000),
  next_action   text check (char_length(next_action) <= 200),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.persons (id) on delete cascade,
  date          date not null,
  period        text not null check (period in ('월', '분기', '반기', '연간')),
  self_score    smallint not null check (self_score between 0 and 10),
  worker_score  smallint check (worker_score between 0 and 10),
  achieved      text check (char_length(achieved) <= 1000),
  adjust        text check (char_length(adjust) <= 1000),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create index intakes_person_idx       on public.intakes (person_id, date);
create index goals_person_idx         on public.goals (person_id);
create index programs_person_idx      on public.programs (person_id, date);
create index consultations_person_idx on public.consultations (person_id, date);
create index evaluations_person_idx   on public.evaluations (person_id, date);

-- 이 이용자의 기록에 접근할 수 있는가 (보관 처리된 이용자는 관리자만)
create function app_private.can_access_person(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.persons p
    where p.id = pid
      and (
        app_private.is_admin()
        or (p.deleted_at is null and (app_private.is_manager() or p.worker_id = app_private.my_staff_id()))
      )
  )
$$;

-- ---------------------------------------------------------------------
-- 5. 변경기록
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  table_name  text not null,
  record_id   uuid,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

-- ---------------------------------------------------------------------
-- 6. 트리거: 작성자·수정자는 클라이언트 값을 믿지 않고 서버에서 채운다
-- ---------------------------------------------------------------------
create function app_private.stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create function app_private.stamp_staff() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create function app_private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (user_id, table_name, record_id, action, old_data, new_data)
  values (
    auth.uid(), tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['persons', 'intakes', 'goals', 'programs', 'consultations', 'evaluations'] loop
    execute format('create trigger stamp before insert or update on public.%I for each row execute function app_private.stamp()', t);
  end loop;
  foreach t in array array['staff', 'persons', 'intakes', 'goals', 'programs', 'consultations', 'evaluations'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app_private.audit()', t);
  end loop;
end $$;
create trigger stamp before insert or update on public.staff for each row execute function app_private.stamp_staff();

-- 관리코드 자동 부여: 담당자는 다른 사람의 이용자를 볼 수 없어 앱이 다음 번호를 알 수 없으므로 서버가 매긴다
create function app_private.assign_person_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  yr text := to_char(coalesce(new.enrolled_at, current_date), 'YYYY');
  n  int;
begin
  if new.code is null or new.code = '' then
    perform pg_advisory_xact_lock(hashtext('ppp_person_code_' || yr));
    select coalesce(max(substring(p.code from '^P-[0-9]{4}-([0-9]+)$')::int), 0) + 1 into n
    from public.persons p where p.code like 'P-' || yr || '-%';
    new.code := 'P-' || yr || '-' || lpad(n::text, 3, '0');
  end if;
  return new;
end $$;

create trigger assign_code before insert on public.persons
for each row execute function app_private.assign_person_code();

-- 직원 명단 ↔ 로그인 계정 연결: 이메일 인증이 끝난 계정만 연결한다
create function app_private.link_staff_from_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null then
    update public.staff s set user_id = new.id
    where s.email = lower(new.email) and s.user_id is null;
  end if;
  return new;
end $$;

create trigger link_staff after insert or update of email_confirmed_at on auth.users
for each row execute function app_private.link_staff_from_user();

create function app_private.link_user_from_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then
    select u.id into new.user_id from auth.users u
    where lower(u.email) = new.email and u.email_confirmed_at is not null
    limit 1;
  end if;
  return new;
end $$;

create trigger link_user before insert on public.staff
for each row execute function app_private.link_user_from_staff();

-- ---------------------------------------------------------------------
-- 7. 권한: 비로그인(anon)은 전부 차단, 로그인(authenticated)은 정책이 허용한 행만
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated;

grant select, insert, update, delete on public.staff to authenticated;
grant select, insert, update, delete on public.persons, public.intakes, public.goals,
  public.programs, public.consultations, public.evaluations to authenticated;
grant select on public.audit_logs to authenticated;

-- 앞으로 public에 새로 만드는 테이블·함수도 자동으로 열리지 않게 한다
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. RLS 켜기 (모든 테이블, 테이블 소유자에게도 적용)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['staff', 'persons', 'intakes', 'goals', 'programs', 'consultations', 'evaluations', 'audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- 직원: 본인 행은 보기, 팀장 이상은 전체 보기, 관리자만 추가·수정·삭제
create policy staff_select on public.staff for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.is_manager()));
create policy staff_insert on public.staff for insert to authenticated
  with check ((select app_private.is_admin()));
create policy staff_update on public.staff for update to authenticated
  using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy staff_delete on public.staff for delete to authenticated
  using ((select app_private.is_admin()));

-- 이용자
create policy persons_select on public.persons for select to authenticated
  using (
    (select app_private.is_admin())
    or (deleted_at is null and ((select app_private.is_manager()) or worker_id = (select app_private.my_staff_id())))
  );
create policy persons_insert on public.persons for insert to authenticated
  with check (
    deleted_at is null
    and ((select app_private.is_manager()) or worker_id = (select app_private.my_staff_id()))
  );
create policy persons_update on public.persons for update to authenticated
  using (
    (select app_private.is_admin())
    or (deleted_at is null and ((select app_private.is_manager()) or worker_id = (select app_private.my_staff_id())))
  )
  -- 담당자는 다른 직원에게 넘길 수 없다(담당 변경은 팀장 이상). 보관 처리·복구는 archive_record()/관리자만
  with check (
    ((select app_private.is_admin()) or deleted_at is null)
    and ((select app_private.is_manager()) or worker_id = (select app_private.my_staff_id()))
  );
create policy persons_delete on public.persons for delete to authenticated
  using ((select app_private.is_admin()));

-- 기록 5종: 이용자에 접근할 수 있으면 접근, 영구 삭제는 관리자만
do $$
declare t text;
begin
  foreach t in array array['intakes', 'goals', 'programs', 'consultations', 'evaluations'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using ((select app_private.is_admin()) or (deleted_at is null and app_private.can_access_person(person_id)));
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check (deleted_at is null and app_private.can_access_person(person_id));
      create policy %1$s_update on public.%1$I for update to authenticated
        using ((select app_private.is_admin()) or (deleted_at is null and app_private.can_access_person(person_id)))
        with check (((select app_private.is_admin()) or deleted_at is null) and app_private.can_access_person(person_id));
      create policy %1$s_delete on public.%1$I for delete to authenticated
        using ((select app_private.is_admin()));
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. 보관 처리(앱의 '삭제') — RLS상 숨겨질 행으로 직접 UPDATE할 수 없으므로 권한을 확인하는 전용 함수로 처리
-- ---------------------------------------------------------------------
create function public.archive_record(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  if not app_private.is_staff() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;
  if p_table = 'persons' then
    if not exists (
      select 1 from public.persons p
      where p.id = p_id and p.deleted_at is null
        and (app_private.is_manager() or p.worker_id = app_private.my_staff_id())
    ) then
      raise exception '보관할 권한이 없거나 기록이 없습니다.' using errcode = '42501';
    end if;
    update public.persons set deleted_at = now() where id = p_id;
  elsif p_table in ('intakes', 'goals', 'programs', 'consultations', 'evaluations') then
    execute format('select person_id from public.%I where id = $1 and deleted_at is null', p_table) into pid using p_id;
    if pid is null or not app_private.can_access_person(pid) then
      raise exception '보관할 권한이 없거나 기록이 없습니다.' using errcode = '42501';
    end if;
    execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
  else
    raise exception '알 수 없는 표입니다: %', p_table using errcode = '22023';
  end if;
end $$;
revoke all on function public.archive_record(text, uuid) from public, anon;
grant execute on function public.archive_record(text, uuid) to authenticated;

-- 변경기록: 관리자만 조회 (추가는 트리거만, 수정·삭제 정책 없음 = 불가)
create policy audit_select on public.audit_logs for select to authenticated
  using ((select app_private.is_admin()));

commit;

-- =====================================================================
-- 첫 관리자 등록 — 아래 이메일을 기관 관리자 계정으로 바꾼 뒤 실행하세요.
-- (SQL Editor는 관리 권한으로 실행되므로 RLS와 무관하게 들어갑니다)
-- 이후 직원 추가는 관리자가 앱 또는 이 표에서 합니다.
-- =====================================================================
-- insert into public.staff (email, name, role) values ('admin@기관도메인.or.kr', '관리자', 'admin');
