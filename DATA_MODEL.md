# DATA_MODEL — 데이터 구조

## 1. 개요
```
Person (이용자 = 책)
 ├─ Intake        초기접수        1:N
 ├─ Goal          목표·계획       1:N
 ├─ ProgramUse    프로그램 이용   1:N
 ├─ Consultation  상담·회의       1:N
 └─ Evaluation    평가            1:N
```
모든 하위 기록은 `personId`로 이용자를 참조한다. 현재 저장 형태는 하나의 JSON 문서(`localStorage['ppp.data.v1']`):
```json
{ "schemaVersion": 1, "persons": [], "intakes": [], "goals": [], "programs": [], "consultations": [], "evaluations": [] }
```
공통 필드: `id`(string, 접두어_랜덤), `createdAt`, `updatedAt`(ISO 8601). 날짜는 `YYYY-MM-DD` 문자열.

## 2. 엔터티
### Person — `persons`
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| id | string | ✔ | `per_…` |
| code | string | ✔ | 관리 코드 `P-YYYY-NNN` (Q4 확인 필요) |
| name | string(≤20) | ✔ | 이름 또는 가명 |
| gender | enum | | 남/여/응답 안 함 |
| birthYM | `YYYY-MM` | | 생년월일 대신 연월만 |
| disabilityType | enum | | 지적장애/자폐성장애/기타/미기재 |
| stage | enum | ✔ | 준비/계획/실천/평가 |
| worker | string(≤20) | ✔ | 담당자 이름 |
| enrolledAt | date | ✔ | 등록일 |
| oneLine | string(≤40) | | 나를 한마디로 |
| dream, strengths, likes, dislikes, comfort | string(≤300) | | 자기소개서 요약 항목 |
| priorities | string[] (≤3) | | 희망 우선 영역, 배열 순서 = 순위 |
| consent | boolean | ✔ | 개인정보 동의서 수령 확인 |

### Intake — `intakes`
| 필드 | 타입 | 필수 |
|---|---|---|
| personId | string | ✔ |
| date | date | ✔ |
| route | enum(아카데미 수료/직접 신청/기관 의뢰/기타) | ✔ |
| applicant | enum(당사자/보호자/당사자·보호자/지원자) | |
| needs | string(≤1000) | ✔ |
| interestDomains | 영역[] | |
| notes | string(≤1000) | |

### Goal — `goals`
| 필드 | 타입 | 필수 |
|---|---|---|
| personId, term(단기/중장기), domain, text(≤200), startDate, status(진행/달성/조정/중단) | | ✔ |
| plan(≤1000), endDate(≥startDate), priority(1~8) | | |

### ProgramUse — `programs`
| 필드 | 타입 | 필수 |
|---|---|---|
| personId, date, programName(≤50), domain, attendance(참여/불참) | | ✔ |
| hours(0.5~12), satisfaction(1~5 문자열), note(≤500) | | |

### Consultation — `consultations`
| 필드 | 타입 | 필수 |
|---|---|---|
| personId, date, type, summary(≤2000) | | ✔ |
| participants(≤100), nextAction(≤200) | | |

`type`: 초기상담 · 준비상담 · 사전회의 · 통합회의 · 컨퍼런스회의 · 확정회의 · 모니터링상담 · 수시상담

### Evaluation — `evaluations`
| 필드 | 타입 | 필수 |
|---|---|---|
| personId, date, period(월/분기/반기/연간), selfScore(0~10) | | ✔ |
| workerScore(0~10), achieved(≤1000), adjust(≤1000) | | |

### 공통 코드
- 영역(8): 교육, 보건의료, 문화여가, 직업, 관계·결혼, 주거, 법적·옹호, 소득재정 — 자기소개서 설계 영역 기준
- 모든 코드는 `js/store.js` 상수에서만 정의

## 3. 저장·삭제·복원 정책
| 동작 | 정책 |
|---|---|
| 저장 | 변경 즉시 전체 문서를 저장. 저장 실패(용량 초과·사생활 모드) 시 데이터 관리 화면에 경고 |
| 수정 | 같은 id 덮어쓰기, `updatedAt` 갱신. 변경 이력은 남지 않음(서버 단계에서 감사 로그) |
| 삭제 | **물리 삭제**. 이용자 삭제 시 하위 기록 연쇄 삭제. 확인창 필수 |
| 백업 | 전체 JSON + `exportedAt` |
| 복원 | `validateBackup` 통과 시에만 전체 교체(병합 아님) |
| 버전 | `schemaVersion` 불일치 시 복원 거부. 구조 변경 시 버전 올리고 마이그레이션 함수 추가 |
| 보존기간 | ❓ 기관 개인정보 처리방침 확인 필요 — 종결 후 파기 기능은 미구현 |

## 4. 후보 엔터티(미확정)
- `adlChecks`: { personId, year, item, level(시도하지않음/수행불가/가끔씩/도움주면가능/수행가능) } — 일상생활·사회관계 체크리스트 연도 비교용
- `annualReviews`: { personId, year, story, happyMoments, score } — “행복한 미래 이야기” 돌아보기
- `selfHelpGroups`: 보호자/당사자 자조모임 활동

## 5. 서버 DB — Supabase (3단계, 스키마 작성 완료)
구현: `supabase/schema.sql`, 설정·권한표: `supabase/README.md`, 권한 시험: `supabase/tests/rls_test.mjs`(49개 시나리오).
- 필드명은 snake_case(`birth_ym`, `worker_id`, `program_name` …). 앱 연결 시 `store.js`에서 camelCase와 변환
- `persons.worker` 문자열 → `worker_id`(staff 참조)로 변경
- 모든 표에 `created_by/updated_by/updated_at`(서버가 채움), `deleted_at`(보관 처리)
- `staff`(직원 명단·역할), `audit_logs`(변경기록) 추가
- 모든 테이블 RLS + FORCE. 담당자는 자기 담당 이용자만, 팀장은 전체, 관리자는 직원 관리·영구 삭제·변경기록

### (이전 설계 메모)
- 권장: PostgreSQL(예: Supabase/Neon 또는 기관 서버). 위 엔터티를 테이블로 1:1 매핑, `person_id` FK + `ON DELETE` 정책은 **소프트 삭제**(`deleted_at`)로 변경.
- 추가 테이블: `users`(실무자 계정·역할), `audit_logs`(누가·언제·무엇을 조회/수정), `person_assignments`(담당자 배정).
- 행 단위 권한: 담당자는 배정된 이용자만 수정, 팀장은 전체 조회.
- 전환 방법: `js/store.js`의 `load/save/upsert/remove`를 API 호출로 교체(화면 코드는 변경 최소화). 기존 브라우저 데이터는 백업 JSON → 서버 가져오기 도구로 이전.
- Vercel 배포 시 API는 Vercel Functions 또는 별도 백엔드. 비밀키는 환경 변수로만 관리.
