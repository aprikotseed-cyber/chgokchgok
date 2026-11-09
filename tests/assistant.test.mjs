import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, parseTime } from '../js/assistant.js';

const now = new Date(2026, 10, 9); // 2026-11-09 (월)
const sched = [
  { n: 1, due: '2026-12-17', date: '2026-12-17', payment: 1_989_534, principal: 0, interest: 1_989_534, balance: 266_000_000 },
  { n: 2, due: '2027-01-17', date: '2027-01-18', payment: 1_186_942, principal: 874, interest: 1_186_068, balance: 265_999_126 },
  { n: 3, due: '2027-02-17', date: '2027-02-17', payment: 266_000_000, principal: 265_999_126, interest: 874, balance: 0 },
];
const data = {
  savings: [{ id: 's1', name: '주거래 적금', kind: '적금', balance: 18_000_000, monthly: 1_000_000, rate: 3.5 }],
  stocks: [
    { id: 't1', name: 'Vanguard S&P 500', ticker: 'VOO', market: 'us', qty: 10, avgPrice: 500, avgCur: 'USD', costKrw: 6_500_000 },
    { id: 't2', name: '삼성전자', ticker: '005930', market: 'kr', qty: 10, avgPrice: 60_000, avgCur: 'KRW' },
  ],
  homes: [{ id: 'h1', name: '우리 집', aptName: '한솔마을', manualPrice: 900_000_000, useAuto: false }],
  debts: [
    { id: 'd1', name: '아낌e보금자리론', kind: '주택담보대출', schedule: sched },
    { id: 'd2', name: '신용대출', kind: '신용대출', balance: 18_000_000, rate: 5.2, method: 'equal', maturity: '2029-06', payDay: 14 },
  ],
  fixed: [
    { id: 'f1', name: '휴대폰', category: '통신', amount: 52_000, day: 21, account: '신용카드' },
    { id: 'f2', name: '인터넷·TV', category: '통신', amount: 33_000, day: 10 },
    { id: 'f3', name: '아파트 관리비', category: '주거', amount: 238_000, day: 25 },
  ],
  records: [{ id: 'r1', type: 'saving', targetId: 's1', date: '2026-03-05', amount: 1_000_000 }],
  snapshots: { '2026-10': { net: 600_000_000 } },
};
const market = { stocks: { VOO: { price: 550, currency: 'USD' }, '005930': { price: 70_000, currency: 'KRW' } }, fx: { USD: 1400 } };
const A = (q) => ask(q, data, market, now);

test('대출: 이름 일부·별칭·띄어쓰기·오타가 달라도 같은 답', () => {
  for (const q of ['보금자리 다음 상환 언제야?', '보금자리론 언제 나가', '주담대 다음 납부일', '보금 자리 원리금 얼마', '보금자리롬 상환일']) {
    const a = A(q).text;
    assert.match(a, /아낌e보금자리론: 12월 17일 \(목\)/, q);
    assert.match(a, /1,989,534원/, q);
  }
});

test('대출: 달을 말하면 그 달 회차 (영업일 기준)', () => {
  const a = A('보금자리 1월에 얼마 나가?').text;
  assert.match(a, /1월 18일/);
  assert.match(a, /1,186,942원/);
  assert.match(A('다음달 대출 상환 얼마야').text, /12월 상환 없|12월 17일/);
});

test('대출: 남은 원금, 회차, 다 갚는 날, 이자', () => {
  assert.match(A('보금자리 남은 원금').text, /266,000,000원/);
  assert.match(A('대출 잔액 얼마 남았어?').text, /아낌e보금자리론 266,000,000원[\s\S]*신용대출 18,000,000원/);
  assert.match(A('보금자리 몇 회차까지 냈어').text, /3회 중 0회/);
  assert.match(A('보금자리 언제 다 갚아?').text, /2월 17일.*3회차/);
  assert.match(A('2027년에 보금자리 낸 이자').text, /2027년 아낌e보금자리론에 낸 이자는 0원/); // 아직 안 낸 해
});

test('고정지출: 합계, 분류, 항목, 이번 달 남은 출금, 기간', () => {
  assert.match(A('고정비 얼마야').text, /323,000원/);
  assert.match(A('통신비 얼마 나가?').text, /통신 고정지출은 매달 85,000원/);
  assert.match(A('휴대폰 요금 언제 빠져?').text, /휴대폰은 매달 21일에 52,000원/);
  const rem = A('이번 달 남은 출금').text;
  assert.match(rem, /11월에 남은 출금은/);
  assert.match(rem, /11\/14 신용대출/);
  assert.match(rem, /11\/21 휴대폰 52,000원/);
  assert.match(A('내일 뭐 나가?').text, /인터넷·TV 33,000원/);
  assert.match(A('이번 주 나갈 돈').text, /이번 주 나갈 돈은/);
});

test('자산·주식·환율', () => {
  assert.match(A('총자산 얼마야').text, /총자산은/);
  assert.match(A('지난달 대비 얼마 늘었어?').text, /10월 기록보다/);
  assert.match(A('적금 얼마 모였어').text, /주거래 적금 잔액은 1,800만원/);
  assert.match(A('집값 얼마야').text, /우리 집 시세는 9억원/);
  const us = A('해외주식 수익 얼마야').text;
  assert.match(us, /해외주식: 평가 770만원 · 수익 \+120만원/);
  assert.match(us, /환율 효과 \+55만원/);
  assert.match(A('VOO 수익률').text, /달러 기준 \+10%[\s\S]*원화 수익 \+120만원/);
  assert.match(A('환율 얼마야').text, /1,400원[\s\S]*평균 매입 환율은 1,300원/);
  assert.match(A('올해 저축한 돈').text, /2026년에 저축한 금액은 100만원/);
});

test('모르는 질문은 아는 척하지 않는다', () => {
  const a = A('내일 날씨 어때?');
  // '내일'이 있어 그날 나갈 돈으로 답하거나, 모른다고 해야 함 (지어낸 답 금지)
  assert.ok(/나갈 돈|모르겠어요|없어요/.test(a.text));
  const b = A('비트코인 사도 될까');
  assert.equal(b.unknown, true);
  assert.ok(b.chips.length > 0);
});

test('시간 표현 읽기', () => {
  assert.equal(parseTime('다음달', now).label, '12월');
  assert.equal(parseTime('작년', now).year, 2025);
  assert.equal(parseTime('3월', now).loose, true);
  assert.equal(parseTime('이번주', now).end.getDate(), 15);
});

test('줄임말과 조사', async () => {
  const { josa } = await import('../js/assistant.js');
  assert.equal(josa('관리비', '은', '는'), '는');
  assert.equal(josa('휴대폰', '은', '는'), '은');
  assert.equal(josa('3만원', '이에요', '예요'), '이에요');
  assert.equal(josa('16일 뒤', '이에요', '예요'), '예요');
  const d2 = { ...data, fixed: [...data.fixed, { id: 'f9', name: '넷플릭스', category: '구독', amount: 17_000, day: 12 }] };
  assert.match(ask('넷플 언제 결제돼', d2, market, now).text, /넷플릭스는 매달 12일에 17,000원/);
  assert.match(A('아파트 관리비 얼마였지').text, /아파트 관리비는 매달 25일/);
});
