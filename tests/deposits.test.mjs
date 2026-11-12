import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyFlow, depositTotal, yearTable, depositYears } from '../js/deposits.js';

const today = '2026-11-12';

test('적금: 연결한 계좌의 입금 기록을 달별로', () => {
  const dep = { id: 'a', name: '청년희망적금', type: '적금', accountId: 's1', amount: 500000, start: '2026-03-03', maturity: '2027-03-03', rate: 5.5 };
  const recs = [3, 4, 5, 6, 7, 8, 9].map((m) => ({ type: 'saving', targetId: 's1', date: `2026-${String(m).padStart(2, '0')}-03`, amount: 500000 }))
    .concat([{ type: 'saving', targetId: 'other', date: '2026-05-01', amount: 999 }, { type: 'withdraw', targetId: 's1', date: '2026-06-01', amount: 1 }]);
  const f = monthlyFlow(dep, recs, today);
  assert.equal(f['2026-03'], 500000);
  assert.equal(f['2026-10'], undefined);
  assert.equal(depositTotal(dep, recs, today), 3500000);
});

test('적금: 계좌를 연결하지 않으면 가입한 달부터 매달 넣은 것으로 (만기까지)', () => {
  const dep = { id: 'b', type: '적금', amount: 300000, start: '2026-03-31', maturity: '2026-09-30' };
  assert.equal(depositTotal(dep, [], today), 300000 * 7);
});

test('예금: 맡긴 돈 + 다달이 이자 (세전 단리)', () => {
  const dep = { id: 'c', type: '예금', amount: 3660000, start: '2025-12-01', rate: 3.6, accountId: 's3' };
  const recs = [{ type: 'saving', targetId: 's3', date: '2026-08-10', amount: 20000 }, { type: 'saving', targetId: 's3', date: '2025-12-01', amount: 3660000 }];
  const f = monthlyFlow(dep, recs, today);
  assert.equal(f['2025-12'], 3660000); // 처음 맡긴 돈은 한 번만
  assert.equal(f['2026-01'], 10980);   // 3,660,000 × 3.6% ÷ 12
  assert.equal(f['2026-08'], 10980 + 20000);
  assert.equal(depositTotal(dep, recs, today), 3660000 + 10980 * 11 + 20000);
});

test('연도 표: 이전 해 합·1~12월·총액', () => {
  const deps = [{ id: 'a', name: 'A', type: '적금', amount: 100, start: '2025-11-01' }];
  const t = yearTable(deps, [], 2026, today);
  assert.equal(t.rows[0].before, 200);
  assert.deepEqual(t.rows[0].months.slice(9, 12), [100, 100, 0]);
  assert.equal(t.rows[0].total, 200 + 1100);
  assert.equal(t.total.total, 1300);
  assert.deepEqual(depositYears(deps, today), [2025, 2026]);
});
