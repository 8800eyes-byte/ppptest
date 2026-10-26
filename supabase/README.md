# Supabase 설정 안내

`schema.sql`은 PPP 이야기 서재의 서버 DB 구조입니다. **모든 테이블에 RLS(행 단위 보안)가 켜져 있고**, 직원 명단에 등록된 계정만 정해진 범위의 데이터를 볼 수 있습니다.

> 앱은 `js/config.js`의 값으로 이 프로젝트에 연결됩니다(`js/remote-store.js`).

## 권한 구조
| 역할 | 이용자·기록 | 직원 명단 | 삭제 | 변경기록 |
|---|---|---|---|---|
| 비로그인 | ✘ | ✘ | ✘ | ✘ |
| 로그인했지만 명단에 없음 / 비활성 | ✘ (0건으로 보임) | ✘ | ✘ | ✘ |
| 담당자 `worker` | **자기 담당 이용자만** 보기·추가·수정 | 본인만 | 보관 처리만 | ✘ |
| 팀장 `manager` | 전체 보기·추가·수정, 담당자 변경 | 전체 보기 | 보관 처리만 | ✘ |
| 관리자 `admin` | 전체 + 보관된 기록 보기·복구 | 추가·수정·삭제 | 보관 + 영구 삭제 | 조회 |

- 앱의 “삭제”는 **보관 처리**(`archive_record()` 함수, `deleted_at` 기록)입니다. 보관된 기록은 관리자만 보고 되살릴 수 있습니다.
- 관리코드(`P-연도-번호`), 작성자·수정자·작성일은 **서버가 채웁니다**(앱이 보낸 값은 무시).
- 모든 추가·수정·삭제는 `audit_logs`에 이전 값과 새 값이 남습니다. 수정·삭제할 수 없습니다.
- 선택지(단계·영역·상담 유형 등)와 글자 수 제한이 DB에서도 검사됩니다.

## 설정 순서
1. **프로젝트 만들기**: supabase.com → New project. Region은 **Northeast Asia (Seoul)** 권장. DB 비밀번호는 기관 비밀번호 관리 규칙대로 보관합니다.
2. **스키마 실행**: SQL Editor → `schema.sql` 전체를 붙여넣고 Run.
3. **첫 관리자 등록**: 같은 SQL Editor에서 실행합니다.
   ```sql
   insert into public.staff (email, name, role) values ('관리자이메일@기관도메인', '관리자', 'admin');
   ```
4. **로그인 방식**: Authentication → Sign In / Providers
   - 기본은 **이메일 로그인 링크**입니다(설정 불필요).
   - **Google**(선택): Google Cloud에서 OAuth 클라이언트를 만들어 Supabase Google 제공자에 Client ID/Secret을 넣고, `js/config.js`의 `googleLogin`을 `true`로 바꾸면 로그인 화면에 Google 버튼이 나타납니다. 리디렉션 URI: `https://<프로젝트>.supabase.co/auth/v1/callback`
   - 이메일 링크 로그인은 처음 로그인할 때 계정을 만들므로 **Allow new users to sign up은 켜 둡니다**. 명단에 없는 사람은 로그인해도 아무것도 볼 수 없습니다.
5. **직원 추가**: 관리자가 `staff`에 이메일·이름·역할을 넣습니다. 그 사람이 처음 로그인하면(이메일 인증된 계정) 자동으로 연결됩니다.
6. **앱에 넣을 값**: Project Settings → API의 **Project URL**과 **anon public key**만 사용합니다. 이 두 값은 화면에 공개되어도 RLS가 막아 줍니다.
   - ⚠️ **service_role key는 앱·문서·메신저 어디에도 넣지 마세요.** RLS를 무시하는 관리자 키입니다.

## 직원 계정 만들기 (비밀번호 로그인, 메일 발송 없음)
Authentication → **Users → Add user → Create new user**
- Email: 직원 이메일(소문자), Password: 임시 비밀번호
- **Auto Confirm User 체크** (체크해야 메일 인증 없이 바로 로그인)
- 같은 이메일이 이미 목록에 있으면(메일 링크를 받은 적이 있으면) 그 사용자를 먼저 **Delete user** 한 뒤 다시 만듭니다.
- 그리고 `staff`에 같은 이메일을 등록합니다(관리자는 이미 등록됨). 계정과 명단은 이메일로 자동 연결됩니다.

## 로그인 주소 설정 (꼭 필요)
Authentication → **URL Configuration**
- **Site URL**: 앱을 여는 주소(예: Vercel 주소 `https://ppp-xxxx.vercel.app`)
- **Redirect URLs**: 같은 주소를 추가. PC에서 직접 열어 시험한다면 `http://localhost:8000`도 추가
이 설정이 없으면 로그인 후 엉뚱한 주소로 돌아갑니다.

이메일 로그인 링크: Supabase 기본 메일 발송은 시간당 몇 통으로 제한됩니다. 직원이 많아지면 Authentication → Emails에서 기관 메일(SMTP)을 연결하세요.

## 시험 데이터 지우기 (관리자, SQL Editor)
앱의 ‘데이터 관리 → 시험용 가상 데이터 넣기’로 넣은 데이터를 실제 사용 전에 지웁니다. **모든 이용자와 기록이 영구 삭제**되므로 실제 데이터를 넣기 전에만 실행하세요.
```sql
delete from public.persons;
```

## 직원 관리 예시 (관리자, SQL Editor)
```sql
-- 담당자 추가
insert into public.staff (email, name, role) values ('kim@기관도메인', '김복지', 'worker');
-- 퇴사·휴직: 비활성화 (즉시 모든 접근 차단, 기록의 작성자 정보는 유지)
update public.staff set active = false where email = 'kim@기관도메인';
-- 이용자 담당 변경 (팀장 이상은 앱에서도 가능)
update public.persons set worker_id = (select id from public.staff where email = 'lee@기관도메인') where code = 'P-2026-001';
```

## 권한 시험
Supabase 없이 PGlite(내장 Postgres)로 49개 권한 시나리오를 시험합니다. 계정과 데이터는 모두 가상입니다.
```bash
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/tests/rls_test.mjs
```
결과 예: `결과: 49개 통과, 0개 실패`

## 확인 필요
- Supabase 실제 프로젝트에서 한 번 더 확인: 스키마의 내부 함수는 `postgres` 역할(RLS 우회 권한 보유)로 실행되는 것을 전제로 합니다. 연결 단계에서 실제 계정으로 위 시나리오를 다시 점검합니다.
- 이용자 정보를 외부 클라우드에 두는 것에 대한 기관 개인정보 승인(국외 이전 해당 여부 포함)
- 변경기록(`audit_logs`)에도 개인정보가 들어가므로 보존 기간·파기 주기 결정
- 백업: 무료 요금제는 자동 백업이 제한적입니다. 운영 시 유료 요금제의 일일 백업 또는 정기 내보내기 필요
