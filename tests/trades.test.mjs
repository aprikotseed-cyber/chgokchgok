import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTrade, undoLastTrade, realizedKrw } from '../js/trades.js';

test('해외주식 매수: 평균 매수가(달러)와 원화 매입금액이 함께 쌓인다', () => {
  // 10주 평균 $500, 원화 6,500,000원(환율 1,300) 보유 중 → $550에 10주 추가, 그날 원화 7,700,000원(환율 1,400)
  const s = { id: 't1', ticker: 'VOO', market: 'us', qty: 10, avgPrice: 500, avgCur: 'USD', costKrw: 6_500_000 };
  const { stock, trade } = applyTrade(s, { type: 'buy', qty: 10, price: 550, cur: 'USD', krw: 7_700_000, date: '2026-11-09' });
  assert.equal(stock.qty, 20);
  assert.equal(stock.avgPrice, 525);
  assert.equal(stock.costKrw, 14_200_000);   // 매입 환율 = 14,200,000 ÷ (20 × 525) ≈ 1,352.4원
  assert.equal(Math.round(trade.fx), 1400);
});

test('해외주식 매도: 평균은 그대로, 원화 매입금액은 판 비율만큼 줄고 실현손익 기록', () => {
  const s = { qty: 20, avgPrice: 525, avgCur: 'USD', costKrw: 14_200_000 };
  const { stock, trade } = applyTrade(s, { type: 'sell', qty: 5, price: 600, cur: 'USD', krw: 4_350_000, date: '2026-12-01' });
  assert.equal(stock.qty, 15);
  assert.equal(stock.avgPrice, 525);
  assert.equal(stock.costKrw, 10_650_000);    // 14,200,000 × 15/20
  assert.equal(trade.realizedKrw, 800_000);   // 4,350,000 − 3,550,000
  assert.equal(trade.realized, 375);          // ($600 − $525) × 5
  assert.throws(() => applyTrade(stock, { type: 'sell', qty: 16, price: 1, cur: 'USD', krw: 1 }), /보유 수량/);
});

test('국내주식 매수·매도는 원화 그대로', () => {
  const s = { qty: 10, avgPrice: 60_000, avgCur: 'KRW' };
  const b = applyTrade(s, { type: 'buy', qty: 10, price: 70_000, cur: 'KRW' }).stock;
  assert.equal(b.avgPrice, 65_000);
  assert.equal(b.costKrw, 1_300_000);
  const { trade } = applyTrade(b, { type: 'sell', qty: 4, price: 80_000, cur: 'KRW' });
  assert.equal(trade.realizedKrw, 60_000);    // 320,000 − 260,000
});

test('소수점 주식(0.083주)도 정확히 쌓인다', () => {
  const s = { qty: 0.083, avgPrice: 705, avgCur: 'USD', costKrw: 79_473 };
  const { stock } = applyTrade(s, { type: 'buy', qty: 0.017, price: 712, cur: 'USD', krw: 17_210 });
  assert.equal(stock.qty, 0.1);
  assert.equal(stock.costKrw, 96_683);
});

test('가장 최근 거래 취소하면 거래 전 상태로', () => {
  let s = { qty: 10, avgPrice: 500, avgCur: 'USD', costKrw: 6_500_000, trades: [] };
  const r = applyTrade(s, { type: 'buy', qty: 10, price: 550, cur: 'USD', krw: 7_700_000 });
  s = { ...r.stock, trades: [r.trade] };
  const back = undoLastTrade(s);
  assert.deepEqual([back.qty, back.avgPrice, back.costKrw, back.trades.length], [10, 500, 6_500_000, 0]);
  assert.equal(realizedKrw([{ trades: [{ realizedKrw: 100 }, { realizedKrw: -30 }] }]), 70);
});
