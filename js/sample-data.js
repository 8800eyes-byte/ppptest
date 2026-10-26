/* 가상 샘플 데이터 — 실제 이용자 정보가 아니다. 이름은 모두 임의로 만든 가명이다.
 * 날짜는 오늘을 기준으로 상대 계산하므로 언제 열어도 최근 기록처럼 보인다.
 */
(function () {
  'use strict';

  var seed = 20261026;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function int(min, max) { return min + Math.floor(rnd() * (max - min + 1)); }
  function daysAgo(n) {
    var d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  var PEOPLE = [
    { name: '가온', gender: '남', birthYM: '2001-03', type: '지적장애', stage: '실천', worker: '김복지', oneLine: '웃음이 많은 사람', dream: '카페에서 바리스타로 일하기' },
    { name: '나래', gender: '여', birthYM: '1998-07', type: '자폐성장애', stage: '실천', worker: '이사랑', oneLine: '그림을 사랑하는 사람', dream: '내 그림으로 전시회 열기' },
    { name: '다온', gender: '남', birthYM: '2004-11', type: '지적장애', stage: '계획', worker: '김복지', oneLine: '운동을 좋아하는 청년', dream: '마라톤 10km 완주하기' },
    { name: '라온', gender: '여', birthYM: '1995-01', type: '지적장애', stage: '평가', worker: '박나눔', oneLine: '꼼꼼한 정리왕', dream: '혼자 사는 내 집 꾸리기' },
    { name: '마루', gender: '남', birthYM: '2002-05', type: '자폐성장애', stage: '준비', worker: '이사랑', oneLine: '기차 박사', dream: '지하철역에서 안내하는 일하기' },
    { name: '바다', gender: '여', birthYM: '1999-09', type: '지적장애', stage: '실천', worker: '박나눔', oneLine: '노래하는 사람', dream: '합창단 공연 무대 서기' },
    { name: '새봄', gender: '여', birthYM: '2003-04', type: '지적장애', stage: '계획', worker: '김복지', oneLine: '친구를 잘 챙기는 사람', dream: '친구들과 제주도 여행 가기' },
    { name: '아라', gender: '남', birthYM: '1997-12', type: '자폐성장애', stage: '실천', worker: '이사랑', oneLine: '컴퓨터를 잘하는 사람', dream: '사무 보조로 취업하기' },
    { name: '하늘', gender: '남', birthYM: '2000-08', type: '지적장애', stage: '평가', worker: '박나눔', oneLine: '요리하는 사람', dream: '가족에게 생일상 차려주기' },
    { name: '은솔', gender: '여', birthYM: '2005-02', type: '지적장애', stage: '준비', worker: '김복지', oneLine: '동물을 좋아하는 사람', dream: '강아지 돌보는 일 배우기' },
    { name: '초롱', gender: '여', birthYM: '1996-06', type: '자폐성장애', stage: '실천', worker: '이사랑', oneLine: '약속을 꼭 지키는 사람', dream: '은행에서 혼자 통장 관리하기' },
    { name: '한결', gender: '남', birthYM: '2001-10', type: '지적장애', stage: '계획', worker: '박나눔', oneLine: '성실한 사람', dream: '도서관에서 일하기' }
  ];

  var PROGRAMS = [
    { name: '바리스타 직업훈련', domain: '직업' }, { name: '사무보조 실습', domain: '직업' },
    { name: '자립생활 요리교실', domain: '주거' }, { name: '내 방 정리 프로젝트', domain: '주거' },
    { name: '건강 걷기 모임', domain: '보건의료' }, { name: '마음챙김 미술', domain: '보건의료' },
    { name: '주말 문화탐방', domain: '문화여가' }, { name: '합창 동아리', domain: '문화여가' },
    { name: '스마트폰 활용 교육', domain: '교육' }, { name: '평생교육 글쓰기', domain: '교육' },
    { name: '용돈 관리 교실', domain: '소득재정' }, { name: '관계 맺기 소모임', domain: '관계·결혼' },
    { name: '시민옹호인 만남', domain: '법적·옹호' }
  ];

  var GOAL_TEXT = {
    '교육': '스마트폰으로 버스 도착 정보 찾기', '보건의료': '주 3회 30분 걷기',
    '문화여가': '한 달에 한 번 친구와 문화활동하기', '직업': '직업훈련 과정 80% 이상 참여하기',
    '관계·결혼': '모임에서 내 이야기 한 번 이상 하기', '주거': '혼자 장보고 간단한 요리 만들기',
    '법적·옹호': '시민옹호인과 정기적으로 만나기', '소득재정': '용돈기입장 매주 작성하기'
  };

  var COUNSEL_TEXT = [
    '최근 활동에 대한 만족도가 높고 다음 달에도 계속 참여하고 싶다고 표현함.',
    '이동 경로가 바뀌어 불안감을 보임. 활동지원사와 함께 경로 연습을 하기로 함.',
    '보호자가 진로에 대한 걱정을 이야기함. 직업 영역 정보 제공.',
    '친구 관계에서 어려움이 있었으나 스스로 사과하고 해결한 경험을 나눔.',
    '건강검진 결과 공유. 식단 관리에 대한 도움이 필요하다고 함.',
    '목표 일부를 조정하기로 합의함. 당사자 의사를 우선 반영.'
  ];

  function build() {
    var data = { schemaVersion: 1, persons: [], intakes: [], goals: [], programs: [], consultations: [], evaluations: [] };
    var stageIndex = { '준비': 0, '계획': 1, '실천': 2, '평가': 3 };
    var t = new Date().toISOString();

    PEOPLE.forEach(function (p, i) {
      var pid = 'per_sample' + (i + 1);
      var si = stageIndex[p.stage];
      var enrolledAgo = 60 + si * 150 + int(0, 60);
      var domains = DOMAINS_SHUFFLE().slice(0, 3);
      data.persons.push({
        id: pid, code: 'P-2026-' + String(i + 1).padStart(3, '0'), name: p.name, gender: p.gender,
        birthYM: p.birthYM, disabilityType: p.type, stage: p.stage, worker: p.worker,
        enrolledAt: daysAgo(enrolledAgo), oneLine: p.oneLine, dream: p.dream,
        strengths: pick(['인사를 잘함', '끝까지 해냄', '손재주가 좋음', '기억력이 좋음']),
        likes: pick(['음악 듣기, 산책', '그림 그리기, 카페', '기차 영상, 지도 보기', '요리, 동물']),
        dislikes: pick(['큰 소리, 갑작스러운 일정 변경', '사람이 많은 곳', '기다리는 상황']),
        comfort: pick(['미리 일정을 알려주기', '조용한 공간에서 잠시 쉬기', '좋아하는 음악 들려주기']),
        priorities: domains, consent: true, createdAt: t, updatedAt: t
      });

      data.intakes.push({
        id: 'int_sample' + (i + 1), personId: pid, date: daysAgo(enrolledAgo),
        route: pick(['아카데미 수료', '아카데미 수료', '직접 신청', '기관 의뢰']),
        applicant: pick(['당사자', '보호자', '당사자·보호자']),
        needs: '본인: ' + p.dream + '. 보호자: 자립 준비와 진로에 대한 정보가 필요함.',
        interestDomains: domains, notes: '자기소개서 작성 안내 완료.', createdAt: t, updatedAt: t
      });

      var meetingFlow = ['초기상담', '사전회의', '통합회의', '컨퍼런스회의', '확정회의'];
      var flowCount = si === 0 ? 1 : si === 1 ? int(2, 4) : 5;
      for (var m = 0; m < flowCount; m++) {
        data.consultations.push({
          id: 'con_s' + i + '_' + m, personId: pid, date: daysAgo(enrolledAgo - 10 - m * 20),
          type: meetingFlow[m], participants: m === 0 ? '당사자, 보호자, 담당자' : '당사자, 보호자, 담당자, 지원자',
          summary: m === 0 ? '서비스 안내 및 회의 설계. 자기소개서 작성 안내.' : meetingFlow[m] + ' 진행. ' + pick(COUNSEL_TEXT),
          nextAction: m < flowCount - 1 ? meetingFlow[m + 1] + ' 일정 조율' : '', createdAt: t, updatedAt: t
        });
      }

      if (si >= 2) {
        domains.forEach(function (d, gi) {
          var gid = 'goa_s' + i + '_' + gi;
          data.goals.push({
            id: gid, personId: pid, domain: d, term: '단기', text: GOAL_TEXT[d],
            startDate: daysAgo(enrolledAgo - 110), endDate: daysAgo(enrolledAgo - 110 - 730),
            status: si === 3 && gi === 0 ? '달성' : pick(['진행', '진행', '진행', '조정']), priority: gi + 1,
            createdAt: t, updatedAt: t
          });
        });
        data.goals.push({
          id: 'goa_s' + i + '_L', personId: pid, domain: domains[0], term: '중장기', text: p.dream,
          startDate: daysAgo(enrolledAgo - 110), endDate: '', status: '진행', priority: 1, createdAt: t, updatedAt: t
        });

        var practiceDays = Math.max(enrolledAgo - 120, 30);
        var pcount = int(10, 22);
        for (var k = 0; k < pcount; k++) {
          var prog = rnd() < 0.7 ? PROGRAMS.filter(function (x) { return domains.indexOf(x.domain) >= 0; })[0] || pick(PROGRAMS) : pick(PROGRAMS);
          if (rnd() < 0.5) prog = pick(PROGRAMS.filter(function (x) { return domains.indexOf(x.domain) >= 0; }).concat([prog]));
          data.programs.push({
            id: 'pro_s' + i + '_' + k, personId: pid, date: daysAgo(int(1, practiceDays)),
            programName: prog.name, domain: prog.domain, hours: pick([1, 1.5, 2, 2, 3]),
            attendance: rnd() < 0.85 ? '참여' : '불참', satisfaction: int(3, 5),
            note: rnd() < 0.3 ? pick(['적극적으로 참여함', '새로운 친구와 짝 활동', '도움 요청을 스스로 함']) : '',
            createdAt: t, updatedAt: t
          });
        }
        var mcount = Math.floor(practiceDays / 45);
        for (var n = 0; n < mcount; n++) {
          var ago = n * 45 + int(3, 25);
          // 일부 이용자는 최근 모니터링이 없도록 남겨 '확인 필요' 목록을 보여준다
          if ((i === 7 || i === 10) && ago < 80) continue;
          data.consultations.push({
            id: 'con_sm' + i + '_' + n, personId: pid, date: daysAgo(ago), type: '모니터링상담',
            participants: '당사자, 담당자', summary: pick(COUNSEL_TEXT), nextAction: '다음 모니터링 일정 안내',
            createdAt: t, updatedAt: t
          });
        }
        var ecount = Math.max(1, Math.floor(practiceDays / 90));
        for (var e = 0; e < ecount; e++) {
          data.evaluations.push({
            id: 'eva_s' + i + '_' + e, personId: pid, date: daysAgo(practiceDays - (e + 1) * 90 + 5 > 0 ? practiceDays - (e + 1) * 90 + 5 : 3),
            period: '분기', selfScore: Math.min(10, 5 + e + int(0, 2)), workerScore: Math.min(10, 5 + e + int(0, 1)),
            achieved: pick(['프로그램에 꾸준히 참여함', '스스로 일정을 확인하기 시작함', '새로운 활동에 도전함']),
            adjust: pick(['현재 계획 유지', '활동 횟수 조정', '목표 표현을 더 쉽게 바꿈']),
            createdAt: t, updatedAt: t
          });
        }
      }
    });
    return data;
  }

  function DOMAINS_SHUFFLE() {
    var a = ['교육', '보건의료', '문화여가', '직업', '관계·결혼', '주거', '법적·옹호', '소득재정'];
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  window.PPP_SAMPLE = function () { seed = 20261026; return build(); };
})();
