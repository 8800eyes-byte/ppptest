# CLAUDE.md — AI 개발 지침

## 1. 프로젝트 목적
- 프로젝트명: **ppp 설계** (화면 이름: *PPP 이야기 서재*)
- 기관: 마들종합사회복지관 (※ 참고자료 서식은 성민복지관 평생과정설계(PPP) 사업 기준 — 기관 확인 필요, PROJECT_SPEC.md §8)
- 목적: 이용자 한 사람에 대한 **초기접수 · 목표/계획 · 프로그램 이용 · 상담/회의/모니터링 · 평가** 기록을 한곳에 모으고, 개인별·전체 단위로 분석한다.
- 주 사용자: 복지관 실무자(담당 사회복지사).
- 핵심 은유: **이용자 1명 = 집 1채 = 책 1권**. 첫 화면은 3D 마을(단계별 구역, 집에 들어가면 장별 방), 서재는 단계별 책장, 상세 화면은 펼친 책(왼쪽 = 나를 소개합니다, 오른쪽 = 장별 기록).

## 2. 작업 원칙
1. 당사자의 존엄성·자기결정권을 우선한다. 기록 문구·화면 문구는 “당사자의 표현을 우선 기록” 관점으로 쓴다.
2. 개인정보는 **최소 수집**한다. 연락처·주소·주민번호·상세 진단명·재산 정보는 현 단계에서 수집하지 않는다(SECURITY.md).
3. 샘플·테스트 데이터는 **가상 데이터만** 사용한다(`js/sample-data.js`). 실제 이용자 정보를 코드·문서·커밋에 넣지 않는다.
4. 확인되지 않은 법령·평가지표·보존기간·기관 규칙은 사실처럼 쓰지 말고 `확인 필요`로 표기한다.
5. 기능을 바꾸면 관련 문서(FEATURES, DATA_MODEL, UI_UX, TEST_PLAN)를 같은 커밋에서 갱신한다.

## 3. 기술 스택
- HTML + CSS + JavaScript(ES5 호환 문법, **프레임워크·빌드 도구 없음**)
- 차트: 직접 만든 SVG(`js/charts.js`), 외부 차트 라이브러리 금지
- 3D: three.js r128(cdnjs, 버전 고정) — 3D 마을에만 사용. 불러오지 못하면 마을 대신 서재로 안내
- 폰트: Google Fonts(Noto Sans KR / Noto Serif KR), 실패 시 시스템 폰트
- 저장: `js/config.js`에 Supabase 값이 있으면 **Supabase**(supabase-js 2.117.3, jsdelivr), 없으면 `localStorage` 시제품 모드
- `Store.upsert/remove`는 서버 모드에서 Promise를 돌려준다. 화면 코드는 항상 `Promise.resolve(...)`로 기다린다
- 배포: Vercel 정적 호스팅(빌드 명령 없음, 루트 = 출력 디렉터리)

## 4. 파일 구조
```
index.html            앱 셸(헤더·모달·스크립트 로드)
css/style.css         디자인 토큰과 전체 스타일(인쇄 스타일 포함)
js/store.js           브라우저 저장소 · 백업 검증 · 선택지 상수
js/config.js          Supabase URL·publishable 키(비우면 브라우저 저장 모드)
js/remote-store.js    Supabase 저장소: 로그인·불러오기·저장·보관 처리(Store API를 서버용으로 교체)
js/sample-data.js     가상 샘플 데이터 생성기
js/charts.js          SVG 차트(가로 막대·세로 막대·선) + 툴팁 + 표로 보기
js/village.js         3D 마을·집 안 방(three.js), 장 내용은 app.js의 PPPApp 함수 재사용
js/app.js             라우터, 화면 렌더링, 입력 폼·검증
supabase/schema.sql   Supabase 스키마(모든 테이블 RLS), supabase/tests = 권한 시험
api/analyze.js        Vercel 서버 함수: AI(Gemini) 분석 초안, api/tests = 시험(node api/tests/analyze_test.js)
*.md                  설계 문서
```

## 5. 코딩 규칙
- 사용자 입력은 화면에 넣기 전에 **반드시 `esc()`로 이스케이프**한다. `innerHTML`에 원본 문자열을 넣지 않는다.
- 데이터 읽기/쓰기는 `window.Store` API(`list/get/upsert/remove`)만 사용한다. 화면 코드에서 `localStorage`의 데이터 키를 직접 다루지 않는다(화면 설정값 `ppp.pref.*` 제외).
- 선택지(단계·영역·상담 유형 등)는 `store.js` 상수에서만 정의한다.
- 새 입력 항목은 `app.js`의 `FORMS` 명세에 추가한다(검증 규칙 포함).
- 색만으로 의미를 전달하지 않는다(단계 색에는 항상 글자 배지를 함께 표시).
- 들여쓰기 2칸, 세미콜론 사용, 한국어 주석은 “왜”를 설명할 때만.

## 6. 금지사항
- 실제 이용자 정보·사진을 샘플/테스트/스크린샷에 사용
- 외부 분석 도구(GA 등)·외부 API로 이용자 데이터 전송. 예외는 `api/analyze.js`(Gemini) 하나: 로그인·직원 확인, RLS로 읽기, 이름·코드·참석자·연락처 제거, 결과 미저장을 유지하고, 실제 이용자 데이터는 기관 승인 + 유료 키 이후(`AI_REAL_DATA_APPROVED=true`)에만
- AI 키(GEMINI_API_KEY)는 Vercel 환경 변수(Secret)에만. 브라우저 코드·저장소에 넣지 않는다
- 백업 검증(`validateBackup`)을 건너뛰는 복원 경로
- RLS를 끄거나 `using (true)` 같은 전체 허용 정책 추가, service_role key를 앱·저장소에 넣기
- schema.sql 권한을 바꾸면 `supabase/tests/rls_test.mjs`에 시나리오를 추가하고 통과 확인
- 확인되지 않은 법적 의무를 화면 문구로 단정

## 7. 완료 기준
- 브라우저 콘솔 오류 0건, TEST_PLAN.md의 해당 시나리오 통과
- 390px 폭에서 가로 스크롤 없음, 키보드만으로 조작 가능
- 관련 문서 갱신 완료
