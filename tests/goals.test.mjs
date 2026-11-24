import test from 'node:test';
import assert from 'node:assert/strict';
import { goalProgress, weeklyReview, weekOf } from '../js/goals.js';

const today = new Date(2026, 10, 22); // 2026-11-22 (일)
const data = {
  savings: [{ id: 's', name: '적금', balance: 10_000_000 }],
  records: [
    { type: 'saving', targetId: 's', date: '2026-03-05', amount: 1_000_000 },
    { type: 'saving', targetId: 's', date: '2026-11-18', amount: 500_000 },
    { type: 'saving', targetId: 's', date: '2025-12-05', amount: 9_000_000 }, // 작년은 빼요
    { type: 'repayment', targetId: 'd', date: '2026-11-17', amount: 300_000 },
  ],
  debts: [{ id: 'd', name: '대출', balance: 40_000_000 }],
  goals: [
    { id: 'g1', title: '올해 저축', kind: 'saving', targetWon: 3_000_000 },
    { id: 'g2', title: '운동', kind: 'exercise', targetCount: 3 },
    { id: 'g3', title: '독서', kind: 'custom', targetCount: 12, current: 9, unit: '권' },
  ],
};
const ev = (startKey, calName = 'Exercise', partner = false) => ({ startKey, calName, partner });
const agenda = { from: '2026-10-01', events: [ev('2026-11-17'), ev('2026-11-19'), ev('2026-11-20', 'Life'), ev('2026-11-21', 'Exercise', true), ev('2026-11-25', 'Work'), ev('2026-11-10')] };

test('주(월~일)', () => {
  assert.deepEqual([weekOf(today).start, weekOf(today).end], ['2026-11-16', '2026-11-22']);
});

test('목표 진행률: 올해 저축 · 이번 주 운동 · 직접 세기', () => {
  const ctx = { data, agenda, today };
  const s = goalProgress(data.goals[0], ctx);
  assert.equal(s.current, 1_500_000);
  assert.equal(Math.round(s.pct), 50);
  assert.match(s.sub, /이 속도면 연말에 약/);
  const e = goalProgress(data.goals[1], ctx);
  assert.equal(e.current, 2); // 반려자·다른 캘린더·지난주는 빼요
  assert.equal(e.text, '이번 주 2회 / 3회');
  assert.match(e.sub, /지난 4주 평균 주 0.3회/);
  assert.equal(goalProgress(data.goals[2], ctx).text, '9권 / 12권');
});

test('주간 돌아보기: 운동·할일·돈·목표·다음 주', () => {
  const tasks = [
    { done: true, completedAt: '2026-11-18' }, { done: true, completedAt: '2026-11-10' },
    { done: false, due: '2026-11-20' }, { done: false, due: '2026-11-26' },
  ];
  const r = weeklyReview({ data, agenda, tasks, today, outflows: () => [{ amount: 238_000 }] });
  assert.equal(r.week, '2026-11-16');
  assert.match(r.body, /운동 2회 \(목표 주 3회 미달\)/);
  assert.match(r.body, /할일 1개 끝냄 · 밀린 할일 1개/);
  assert.match(r.body, /저축 \+500,000원 · 대출 원금 −300,000원/);
  assert.match(r.body, /올해 목표: 올해 저축 50%, 독서 75%/);
  assert.match(r.body, /다음 주: 일정 1개 · 마감 할일 1개 · 나갈 돈 238,000원/);
});

test('목표: 올해 읽은 책은 독서 기입장의 다 읽음으로 세요', () => {
  const books = [{ status: 'done', end: '2026-03-01' }, { status: 'done', end: '2025-12-01' }, { status: 'reading' }, { status: 'done', end: '2026-11-20' }];
  const p = goalProgress({ kind: 'books', targetCount: 12 }, { data: {}, agenda: null, today: new Date(2026, 10, 22), books });
  assert.equal(p.current, 2);
  assert.equal(p.text, '2권 / 12권');
});
