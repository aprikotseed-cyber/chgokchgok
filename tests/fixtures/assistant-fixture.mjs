// 비서 점검용 가짜 데이터 (덕준님 실제 구성과 비슷한 모양, 이름·금액은 모두 예시)
// 기준일: 2026-11-13 (금)
export const NOW = new Date(2026, 10, 13, 9, 0);

function schedule() {
  const rows = [];
  let bal = 300_000_000;
  for (let n = 1; n <= 360 && bal > 0; n++) {
    const d = new Date(2024, 2 + n, 17);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-17`;
    const interest = Math.round(bal * 0.0325);
    const principal = Math.min(bal, 600_000 + n * 1000);
    bal -= principal;
    rows.push({ n, due: ds, date: ds, payment: principal + interest, principal, interest, balance: bal });
  }
  return rows;
}

export const DATA = {
  savings: [
    { id: 's1', name: '주거래 적금', kind: '적금', balance: 18_000_000, monthly: 1_000_000, rate: 3.5 },
    { id: 's2', name: '파킹통장', kind: '파킹통장', balance: 7_000_000, rate: 2.5 },
    { id: 's3', name: '정기예금', kind: '예금', balance: 30_000_000, rate: 3.2 },
  ],
  stocks: [
    { id: 't1', name: '삼성전자', ticker: '005930', market: 'kr', qty: 40, avgPrice: 68_000, avgCur: 'KRW' },
    { id: 't2', name: 'Vanguard S&P 500', ticker: 'VOO', market: 'us', qty: 15, avgPrice: 471.2, avgCur: 'USD', costKrw: 9_520_000 },
    { id: 't3', name: 'Apple', ticker: 'AAPL', market: 'us', qty: 12, avgPrice: 198.5, avgCur: 'USD', costKrw: 3_310_000 },
    { id: 't4', name: 'TIGER 미국S&P500', ticker: '360750', market: 'pension', qty: 210, avgPrice: 17_850, avgCur: 'KRW' },
  ],
  homes: [{ id: 'h1', name: '우리 집', aptName: '예시마을', share: 100, useAuto: false, manualPrice: 950_000_000, purchasePrice: 830_000_000 }],
  debts: [
    { id: 'd1', name: '보금자리론', kind: '주택담보대출', schedule: schedule() },
    { id: 'd2', name: '교직원공제회', kind: '교직원공제회', original: 50_000_000, balance: 40_000_000, rate: 4.1, payDay: 17, method: 'equal', maturity: '2031-03' },
  ],
  fixed: [
    { id: 'f1', name: '아파트 관리비', category: '주거', amount: 238_000, day: 25, account: '주거래 통장' },
    { id: 'f2', name: '휴대폰', category: '통신', amount: 52_000, day: 21, account: '신용카드' },
    { id: 'f3', name: '인터넷·TV', category: '통신', amount: 33_000, day: 10, account: '신용카드' },
    { id: 'f4', name: '실손보험', category: '보험', amount: 41_200, day: 15, account: '주거래 통장' },
    { id: 'f5', name: '어린이재단 후원', category: '기부·후원', amount: 30_000, day: 20 },
    { id: 'f6', name: '넷플릭스', category: '구독', amount: 17_000, day: 9, account: '신용카드' },
    { id: 'f7', name: '유튜브 프리미엄', category: '구독', amount: 14_900, day: 28, account: '신용카드' },
    { id: 'f8', name: '쿠팡 와우', category: '구독', amount: 7_890, day: 3, account: '신용카드' },
    { id: 'f9', name: '클라우드 저장공간', category: '구독', amount: 44_000, day: 2, cycle: 'yearly', month: 3, account: '신용카드' },
  ],
  records: [
    { id: 'r1', type: 'saving', targetId: 's1', date: '2026-10-05', amount: 1_000_000 },
    { id: 'r2', type: 'saving', targetId: 's1', date: '2025-10-05', amount: 1_000_000 },
    { id: 'r3', type: 'repayment', targetId: 'd2', date: '2026-10-17', amount: 700_000, interest: 140_000 },
    { id: 'r4', type: 'repayment', targetId: 'd2', date: '2025-10-17', amount: 690_000, interest: 150_000 },
  ],
  snapshots: { '2026-10': { net: 700_000_000 } },
};

export const MARKET = {
  fx: { USD: 1395 },
  stocks: { '005930': { price: 71_200, currency: 'KRW' }, '360750': { price: 21_340, currency: 'KRW' }, VOO: { price: 552.3, currency: 'USD' }, AAPL: { price: 226.4, currency: 'USD' } },
};

const ev = (id, title, startKey, time, calName, extra = {}) => ({
  id, calId: calName.toLowerCase(), calName, color: '', partner: false, title, location: '',
  allDay: !time, startKey, endKey: startKey, time: time || '', endTime: time ? `${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}${time.slice(2)}` : '', ...extra,
});
export const AGENDA = {
  linked: true,
  until: '2027-02-28',
  calendars: ['Exercise', 'Cherish', 'Birthday', 'Work', 'Life'].map((n) => ({ id: n.toLowerCase(), name: n, color: '' })),
  keywords: [],
  events: [
    ev('e1', '헬스', '2026-11-13', '19:00', 'Exercise'),
    ev('e2', '학부모 상담', '2026-11-13', '15:30', 'Work'),
    ev('e3', '동학년 협의회', '2026-11-16', '15:00', 'Work'),
    ev('e4', '연구 면담', '2026-11-19', '16:00', 'Life'),
    ev('e5', '대학원 수업', '2026-11-19', '17:00', 'Life', { location: '본관 201호' }),
    ev('e6', '엄마 생신', '2026-11-22', '', 'Birthday'),
    ev('e7', '뮤지컬 관람', '2026-11-21', '14:00', 'Cherish'),
    ev('e8', '요가', '2026-11-17', '07:00', 'Exercise'),
    ev('e9', '랩미팅', '2026-11-18', '10:30', '반려자', { partner: true, calId: 'partner' }),
    ev('e10', '2027년 대학원 수업', '2027-01-07', '', 'Life'),
    ev('e11', '부장 회식', '2026-12-02', '18:30', 'Work'),
    ev('e12', '종업식', '2027-02-12', '', 'Work'),
  ],
  tasks: [
    { id: 't1', title: '교육청 공문 회신', due: '2026-11-12', time: '', done: false },
    { id: 't2', title: '수학 단원평가 채점', due: '2026-11-13', time: '16:00', done: false },
    { id: 't3', title: '우유 사기', due: '2026-11-13', time: '', done: false },
    { id: 't4', title: '현장체험학습 동의서 걷기', due: '2026-11-16', time: '', done: false },
    { id: 't5', title: '부서별 평가자료 제출', due: '2026-11-17', time: '', done: false },
    { id: 't6', title: '읽고 싶은 책 정리', due: '', time: '', done: false },
    { id: 't7', title: '연말정산 서류 준비', due: '2026-11-10', done: true, completedAt: '2026-11-11' },
  ],
};

export const MEMOS = [
  { id: 'm1', text: '학부모 상담 때 물어볼 것', pinned: true, createdAt: 3 },
  { id: 'm2', text: '와이파이 비밀번호 바뀜: 공유기 뒷면 확인', createdAt: 2 },
  { id: 'm3', text: '다음 학기 연수 후보: 디지털 리터러시', createdAt: 1 },
];
