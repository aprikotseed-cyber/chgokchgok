import test from 'node:test';
import assert from 'node:assert/strict';
import { simulatePrepay, prepayFee } from '../js/prepay.js';
import { parseAmount } from '../js/assistant.js';

const now = new Date(2026, 10, 16);
const annuity = (b, rate, n) => { const i = rate / 1200; return (b * i) / (1 - Math.pow(1 + i, -n)); };

test('중도상환: 원리금균등은 남은 원금으로 다시 계산한 월상환액과 같아요', () => {
  const loan = { name: '공제회', balance: 40_000_000, rate: 4.2, method: 'annuity', maturity: '2031-11' };
  const s = simulatePrepay(loan, 10_000_000, now);
  const n = s.months;
  assert.ok(Math.abs(s.next.before - annuity(40_000_000, 4.2, n)) < 1);
  assert.ok(Math.abs(s.next.after - annuity(30_000_000, 4.2, n)) < 1);
  assert.equal(s.after, 30_000_000);
  // 기간을 줄이면 몇 달 일찍 끝나고, 이자는 월상환액을 줄일 때보다 더 아껴요
  assert.ok(s.shorter.months > 0);
  assert.ok(s.shorter.saved > s.lower.saved);
});

test('중도상환: 남은 원금보다 많이 갚으면 다 갚는 걸로', () => {
  const s = simulatePrepay({ name: 'x', balance: 5_000_000, rate: 4, method: 'equal', maturity: '2028-11' }, 9_000_000, now);
  assert.equal(s.all, true);
  assert.equal(s.amount, 5_000_000);
});

test('중도상환수수료: 수수료율 × 남은 기간 비율(3년 기준), 기간이 지나면 0원, 비워 두면 모름', () => {
  assert.equal(prepayFee({ prepayFee: 1.2, feeEnd: '2028-05' }, 10_000_000, now).fee, 60_000); // 18개월 남음 → 절반
  assert.equal(prepayFee({ prepayFee: 1.2, feeEnd: '2026-10' }, 10_000_000, now).fee, 0);
  assert.equal(prepayFee({ prepayFee: 1.2 }, 10_000_000, now).fee, 120_000);
  assert.equal(prepayFee({ prepayFee: 0 }, 10_000_000, now).rate, 0);
  assert.equal(prepayFee({ prepayFee: '' }, 10_000_000, now).known, false);
  assert.equal(prepayFee({}, 10_000_000, now).known, false);
});

test('금액 읽기: 숫자·한글·만/억 섞어 써도', () => {
  const cases = { '3천만원': 3e7, '3,000만 원': 3e7, '삼천만원': 3e7, '1억 5천': 1.5e8, '1억5천만원': 1.5e8, '오백만원': 5e6, '천만원': 1e7, '500': 5e6, '2.5천만원': 2.5e7, '이천오백만원': 2.5e7, '30000000원': 3e7, '500만만 갚아도': 5e6, '2천 원금 상환': 2e7, '2027년 2월 3천만원': 3e7 };
  for (const [q, v] of Object.entries(cases)) assert.equal(parseAmount(q), v, q);
  for (const q of ['이자 3%', '10월에 상환한 원금', '2027년 2월', '3회차']) assert.equal(parseAmount(q), null, q);
});

test('중도상환: 만기를 안 넣은 대출도 월상환액 줄도록 보여 주고, 만기를 넣으라고 안내', async () => {
  const { ask } = await import('../js/assistant.js');
  const data = { debts: [{ id: 'd2', name: '교직원공제회', kind: '교직원공제회', balance: 40_000_000, rate: 4.1, payDay: 17, method: 'annuity' }], fixed: [], savings: [] };
  const r = ask('교직원공제회 대출 1000만원을 중도상환하면 월 상환액이 얼마가 돼?', data, {}, now);
  assert.equal(r.via, 'prepay');
  assert.match(r.text, /월상환액: 136,667원 → 약 102,500원/);
  assert.match(r.text, /만기가 입력되지 않아서/);
});
