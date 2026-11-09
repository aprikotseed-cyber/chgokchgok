import test from 'node:test';
import assert from 'node:assert/strict';
import { project, currentTotals, currentPayment, stockValue, milestones } from '../js/projection.js';

const now = new Date(2026, 10, 9); // 2026-11-09

test('원리금균등 대출은 만기에 정확히 0원이 된다', () => {
  const data = { debts: [{ balance: 120_000_000, rate: 4, method: 'annuity', maturity: '2036-11' }] };
  const { points } = project(data, {}, { years: 12, now });
  const y2035 = points.find((p) => p.year === 2035);
  const y2036 = points.find((p) => p.year === 2036);
  assert.ok(y2035.debts > 0);
  assert.ok(y2036.debts < 1, `2036년 말 잔액 ${y2036.debts}`);
});

test('원리금균등 월 납입액이 표준 공식과 같다', () => {
  const loan = { balance: 100_000_000, rate: 6, method: 'annuity', maturity: '2036-11' };
  const n = 120, i = 0.005;
  const expected = (1e8 * i) / (1 - Math.pow(1 + i, -n));
  assert.ok(Math.abs(currentPayment(loan, now) - expected) < 1);
});

test('원금균등은 매달 원금이 같고, 만기일시는 만기까지 잔액 유지', () => {
  const data = {
    debts: [
      { balance: 24_000_000, rate: 3, method: 'equal', maturity: '2028-11' },
      { balance: 50_000_000, rate: 5, method: 'bullet', maturity: '2029-03' },
    ],
  };
  const { points } = project(data, {}, { years: 4, now });
  const at = (y) => points.find((p) => p.year === y).byLoan;
  assert.equal(Math.round(at(2027)[0]), 24_000_000 - 1_000_000 * 13);
  assert.equal(at(2028)[1], 50_000_000);
  assert.equal(at(2029)[1], 0);
});

test('거치기간 동안은 원금이 줄지 않는다', () => {
  const data = { debts: [{ balance: 1e8, rate: 4, method: 'annuity', maturity: '2046-11', graceEnd: '2028-11' }] };
  const { points } = project(data, {}, { years: 4, now });
  assert.equal(points.find((p) => p.year === 2027).debts, 1e8);
  assert.ok(points.find((p) => p.year === 2029).debts < 1e8);
});

test('저축: 이자 0%면 월 저축액만큼 정확히 늘어난다', () => {
  const data = { savings: [{ balance: 10_000_000, monthly: 1_000_000, rate: 0 }] };
  const { points } = project(data, {}, { years: 1, now });
  assert.equal(points[1].savings, 11_000_000); // 다음 달(12월) 한 번 저축
  assert.equal(points[1].label, '2026');
});

test('주식: 자동 시세와 환율을 반영하고, 없으면 수동가를 쓴다', () => {
  const market = { stocks: { AAPL: { price: 200, currency: 'USD' }, '005930': { price: 70000, currency: 'KRW' } }, fx: { USD: 1400 } };
  assert.equal(stockValue({ ticker: 'aapl', qty: 10 }, market), 2_800_000);
  assert.equal(stockValue({ ticker: '005930', qty: 10 }, market), 700_000);
  assert.equal(stockValue({ ticker: 'XYZ', qty: 2, manualPrice: 5000 }, market), 10_000);
});

test('집: 실거래가 추정치 × 지분, 자동 끄면 수동 시세', () => {
  const market = { homes: { h1: { estimate: 1_000_000_000 } } };
  const t = currentTotals({ homes: [{ id: 'h1', share: 50, manualPrice: 9e8 }] }, market);
  assert.equal(t.homes, 5e8);
  const t2 = currentTotals({ homes: [{ id: 'h1', share: 100, manualPrice: 9e8, useAuto: false }] }, market);
  assert.equal(t2.homes, 9e8);
});

test('이정표: 빚 0원 되는 해', () => {
  const data = { savings: [{ balance: 5e7, monthly: 0, rate: 0 }], debts: [{ balance: 1e7, rate: 0, method: 'equal', maturity: '2028-06' }] };
  const { points } = project(data, {}, { years: 5, now });
  assert.equal(milestones(points).debtFreeYear, 2028);
});

test('체증식: 주금공 예시(3억·4.55%·30년·첫 회 116만원)는 140회차까지 균등식보다 낮고 만기에 0원', async () => {
  const { loanMonth, graduatedInfo } = await import('../js/projection.js');
  const loan = { balance: 3e8, rate: 4.55, method: 'graduated', maturity: '2056-11', payment: 1_160_000 };
  const info = graduatedInfo(loan, now);
  assert.equal(info.months, 360);
  const annuity = (3e8 * (0.0455 / 12)) / (1 - Math.pow(1 + 0.0455 / 12, -360));
  const pay = (k) => 1_160_000 + (k - 1) * info.step;
  assert.ok(pay(140) < annuity && pay(141) > annuity, `140회 ${pay(140)}, 141회 ${pay(141)}, 균등 ${annuity}`);
  assert.equal(Math.round(currentPayment(loan, now)), 1_160_000);
  const { points } = project({ debts: [loan] }, {}, { years: 31, now });
  assert.ok(points.find((p) => p.year === 2056).debts < 1);
  assert.ok(points.find((p) => p.year === 2055).debts > 0);
  // 첫 달 원금 = 116만 − 이자 113만7,500 = 22,500원
  const first = loanMonth(3e8, { ...loan, _now: now, _gradD: info.step, _grace: 0 }, 1);
  assert.equal(Math.round(first.principal), 22_500);
});

test('체증식인데 이번 달 원리금을 안 넣으면 원리금균등으로 계산', () => {
  const g = currentPayment({ balance: 1e8, rate: 6, method: 'graduated', maturity: '2036-11' }, now);
  const a = currentPayment({ balance: 1e8, rate: 6, method: 'annuity', maturity: '2036-11' }, now);
  assert.ok(Math.abs(g - a) < 1);
});

test('체증식: 3달 전에 입력한 원리금도 그동안 늘어난 만큼 반영', async () => {
  const { graduatedInfo } = await import('../js/projection.js');
  const base = { balance: 3e8, rate: 4.55, method: 'graduated', maturity: '2056-11', payment: 1_160_000, paymentAsOf: '2026-11' };
  const d = graduatedInfo(base, now).step;
  // 3달 뒤 시점: 원금은 그 사이 갚은 만큼 줄어든 상태
  let bal = 3e8;
  const i = 0.0455 / 12;
  for (let k = 1; k <= 3; k++) bal -= 1_160_000 + (k - 1) * d - bal * i;
  const later = new Date(2027, 1, 9);
  const g = graduatedInfo({ ...base, balance: bal }, later);
  assert.ok(Math.abs(g.step - d) < 1, `${g.step} vs ${d}`);
  assert.ok(Math.abs(g.now - (1_160_000 + 3 * d)) < 5);
});

test('예측에 집값·주가 상승률을 쓰지 않는다 (예전 데이터에 값이 남아 있어도 무시)', () => {
  const market = { homes: { h1: { estimate: 1e9 } }, stocks: { '005930': { price: 70000, currency: 'KRW' } } };
  const data = {
    homes: [{ id: 'h1', growth: 5 }],
    stocks: [{ ticker: '005930', qty: 100 }],
    stockPlan: { monthly: 100_000, rate: 10 },
  };
  const { points } = project(data, market, { years: 3, now });
  const last = points.at(-1);
  assert.equal(last.homes, 1e9);
  const months = (2028 - 2026) * 12 + 1; // 2026년 12월 ~ 2028년 12월
  assert.equal(last.stocks, 7_000_000 + 100_000 * months);
});
