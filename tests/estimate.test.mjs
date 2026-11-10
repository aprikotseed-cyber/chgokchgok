import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateMonths, estimateAt, stockCostAt } from '../js/estimate.js';
import { applyTrade } from '../js/trades.js';
import { trend } from '../js/history.js';

const today = new Date(2026, 10, 10); // 2026-11-10

test('저축: 그 달 말 이후 저축은 빼고 출금은 더해요', () => {
  const data = {
    savings: [{ id: 's', balance: 1_000_000 }],
    records: [
      { type: 'saving', targetId: 's', date: '2026-08-25', amount: 300_000 },
      { type: 'saving', targetId: 's', date: '2026-09-25', amount: 300_000 },
      { type: 'withdraw', targetId: 's', date: '2026-10-05', amount: 100_000 },
      { type: 'saving', targetId: 's', date: '2026-10-25', amount: 300_000 },
    ],
  };
  const m = estimateMonths(data, {}, today);
  assert.deepEqual(Object.keys(m), ['2026-08', '2026-09', '2026-10']);
  assert.equal(m['2026-10'].savings, 1_000_000);
  assert.equal(m['2026-09'].savings, 1_000_000 - 300_000 + 100_000);
  assert.equal(m['2026-08'].savings, 500_000);
  assert.ok(m['2026-08'].est);
});

test('주식은 주가 대신 그때 넣어 둔 원금', () => {
  let s = { id: 'a', ticker: '005930', qty: 0, trades: [] };
  for (const t of [
    { type: 'buy', qty: 10, price: 50_000, cur: 'KRW', date: '2026-07-03' },
    { type: 'buy', qty: 10, price: 70_000, cur: 'KRW', date: '2026-09-03' },
    { type: 'sell', qty: 10, price: 90_000, cur: 'KRW', date: '2026-10-03' },
  ]) { const r = applyTrade(s, t); s = { ...r.stock, trades: [...s.trades, r.trade] }; }
  const market = { stocks: { '005930': { price: 999_999, currency: 'KRW' } } };
  assert.equal(stockCostAt(s, '2026-06-30', market), 0);
  assert.equal(stockCostAt(s, '2026-07-31', market), 500_000);
  assert.equal(stockCostAt(s, '2026-09-30', market), 1_200_000);
  assert.equal(stockCostAt(s, '2026-10-31', market), 600_000);
  const e = estimateAt({ stocks: [s] }, market, '2026-09');
  assert.equal(e.stocks, 1_200_000);
  assert.equal(e.net, 1_200_000);
});

test('대출: 스케줄 잔액 또는 지금 잔액 + 그 뒤 상환 원금, 주택은 그 달 중앙값', () => {
  const data = {
    debts: [
      { id: 'd', balance: 9_000_000 },
      { id: 'k', schedule: [{ date: '2026-09-15', principal: 100, balance: 900 }, { date: '2026-10-15', principal: 100, balance: 800 }] },
    ],
    homes: [{ id: 'h', share: 50 }],
    records: [{ type: 'repayment', targetId: 'd', date: '2026-10-20', amount: 1_000_000 }],
  };
  const market = { homes: { h: { estimate: 600, monthly: [{ ym: '2026-08', median: 400 }, { ym: '2026-10', median: 500 }] } } };
  const m = estimateMonths(data, market, today);
  assert.deepEqual(Object.keys(m), ['2026-10']);
  assert.equal(m['2026-10'].debts, 9_000_000 + 800);
  const sep = estimateAt(data, market, '2026-09');
  assert.equal(sep.debts, 10_000_000 + 900);
  assert.equal(sep.homes, 200); // 9월 거래가 없으면 8월 중앙값, 지분 50%
});

test('기록이 없으면 추정도 없어요', () => {
  assert.deepEqual(estimateMonths({ savings: [{ id: 's', balance: 5 }] }, {}, today), {});
});

test('추이: 매일 기록이 있는 달은 실제 기록이 우선, 없는 달만 추정', () => {
  const days = { '2026-11-09': { net: 900, savings: 900, stocks: 0, homes: 0, debts: 0 }, '2026-10-30': { net: 800, savings: 800, stocks: 0, homes: 0, debts: 0 } };
  const est = { '2026-09': { net: 700, savings: 700, stocks: 0, homes: 0, debts: 0, est: true }, '2026-10': { net: 1, savings: 1, stocks: 0, homes: 0, debts: 0, est: true } };
  const t = trend(days, {}, 'month', today, est);
  assert.deepEqual(t.points.map((p) => [p.key, p.net, !!p.est]), [['2026-09', 700, true], ['2026-10', 800, false], ['2026-11', 900, false]]);
  const d = trend(days, {}, 'day', today, est);
  assert.ok(d.points.every((p) => !p.est));
});
