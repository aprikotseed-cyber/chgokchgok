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
