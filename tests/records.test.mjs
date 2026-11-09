import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertRecord, deleteRecord, yearlySummary, monthlySummary, byTarget } from '../js/records.js';

const fresh = () => ({
  savings: [{ id: 's1', balance: 1_000_000 }],
  debts: [{ id: 'd1', balance: 10_000_000 }],
  records: [],
});

test('저축 기록은 잔액을 늘리고, 수정·삭제하면 되돌린다', () => {
  const d = fresh();
  upsertRecord(d, { id: 'r1', type: 'saving', targetId: 's1', date: '2026-11-09', amount: 300_000, applied: true });
  assert.equal(d.savings[0].balance, 1_300_000);
  upsertRecord(d, { id: 'r1', type: 'saving', targetId: 's1', date: '2026-11-09', amount: 500_000, applied: true });
  assert.equal(d.savings[0].balance, 1_500_000);
  deleteRecord(d, 'r1');
  assert.equal(d.savings[0].balance, 1_000_000);
  assert.equal(d.records.length, 0);
});

test('상환 기록은 원금만큼 대출 잔액을 줄이고, 이자는 영향 없음', () => {
  const d = fresh();
  upsertRecord(d, { id: 'r1', type: 'repayment', targetId: 'd1', date: '2026-11-25', amount: 800_000, interest: 30_000, applied: true });
  assert.equal(d.debts[0].balance, 9_200_000);
});

test('잔액 반영을 끈 기록(옛날 기록 등)은 잔액을 건드리지 않는다', () => {
  const d = fresh();
  upsertRecord(d, { id: 'r1', type: 'saving', targetId: 's1', date: '2025-03-01', amount: 300_000, applied: false });
  assert.equal(d.savings[0].balance, 1_000_000);
  // 반영 켜기로 수정하면 그때 반영
  upsertRecord(d, { id: 'r1', type: 'saving', targetId: 's1', date: '2025-03-01', amount: 300_000, applied: true });
  assert.equal(d.savings[0].balance, 1_300_000);
});

test('연도별·월별·항목별 합계', () => {
  const records = [
    { type: 'saving', targetId: 's1', date: '2026-01-10', amount: 100 },
    { type: 'saving', targetId: 's1', date: '2026-01-25', amount: 50 },
    { type: 'repayment', targetId: 'd1', date: '2026-03-25', amount: 200, interest: 20 },
    { type: 'saving', targetId: 's2', date: '2025-12-10', amount: 70 },
  ];
  const y = yearlySummary(records);
  assert.deepEqual(y.map((x) => x.year), ['2026', '2025']);
  assert.equal(y[0].saving, 150);
  assert.equal(y[0].principal, 200);
  assert.equal(y[0].interest, 20);
  const m = monthlySummary(records, 2026);
  assert.equal(m[0].saving, 150);
  assert.equal(m[2].principal, 200);
  assert.equal(byTarget(records, 2026).length, 2);
});

test('출금: 계좌 잔액을 줄이고, 저축 합계는 넣은 돈 − 뺀 돈', () => {
  const d = { savings: [{ id: 's1', balance: 1_000_000 }], debts: [], records: [] };
  upsertRecord(d, { id: 'r1', type: 'saving', targetId: 's1', date: '2026-11-01', amount: 500_000, applied: true });
  upsertRecord(d, { id: 'r2', type: 'withdraw', targetId: 's1', date: '2026-11-05', amount: 200_000, applied: true });
  assert.equal(d.savings[0].balance, 1_300_000);
  deleteRecord(d, 'r2');
  assert.equal(d.savings[0].balance, 1_500_000);
  const recs = [
    { type: 'saving', targetId: 's1', date: '2026-11-01', amount: 500_000 },
    { type: 'withdraw', targetId: 's1', date: '2026-11-05', amount: 200_000 },
  ];
  const y = yearlySummary(recs)[0];
  assert.deepEqual([y.saving, y.withdraw], [300_000, 200_000]);
  const t = byTarget(recs, 2026);
  assert.equal(t.length, 1);
  assert.equal(t[0].saving, 300_000);
});
