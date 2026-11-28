import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTask, nextRepeatTask, kstMs, remindersDue, reminderText } from '../js/tasks.js';

test('반복 할일: 끝내면 다음 차례, 중복으로 만들지 않아요', () => {
  const rule = { freq: 'weekly', interval: 1, byday: [1, 4] };
  const a = { ...makeTask({ title: '귀 세척', due: '2026-11-09', time: '21:00', repeat: rule }), done: true };
  const n = nextRepeatTask(a, [a], '2026-11-12');
  assert.deepEqual([n.due, n.time, n.series, n.title], ['2026-11-12', '21:00', a.series, '귀 세척']);
  // 다음 차례가 이미 있으면 만들지 않아요
  assert.equal(nextRepeatTask(a, [a, n], '2026-11-12'), null);
  // 반복이 아니면 없음
  assert.equal(nextRepeatTask({ ...a, repeat: null }, [], '2026-11-12'), null);
});

test('30분 전 알림: 0~30분 남은 것만, 한 번만', () => {
  const now = kstMs('2026-11-12', '20:35');
  const items = [
    { key: 'a', start: kstMs('2026-11-12', '21:00'), title: '귀 세척', time: '21:00', kind: 'task' },
    { key: 'b', start: kstMs('2026-11-12', '21:30'), title: '늦은 것', time: '21:30', kind: 'event' },
    { key: 'c', start: kstMs('2026-11-12', '20:30'), title: '지난 것', time: '20:30', kind: 'event' },
  ];
  assert.deepEqual(remindersDue(items, now).map((x) => x.key), ['a']);
  assert.deepEqual(remindersDue(items, now, { a: now }).map((x) => x.key), []);
  assert.equal(kstMs('2026-11-12', '21:00'), Date.UTC(2026, 10, 12, 12, 0));
  assert.match(reminderText([items[0]]).body, /21:00에 할 일 ‘귀 세척’/);
  assert.match(reminderText(items.slice(0, 2)).title, /2개/);
});

test('루틴: 반복 할일은 루틴, 직접 끈 건 아니고, 오늘 루틴은 지난 것도 하나만', async () => {
  const { isRoutine, routinesToday, makeTask, nextRepeatTask } = await import('../js/tasks.js');
  const daily = { freq: 'daily', interval: 1 };
  assert.equal(isRoutine({ repeat: daily }), true);
  assert.equal(isRoutine({ repeat: daily, routine: false }), false);
  assert.equal(isRoutine({ routine: true }), true);
  assert.equal(isRoutine({}), false);
  const tasks = [
    { id: 'a', title: '영양제', repeat: daily, series: 'a', due: '2026-11-23', done: false },
    { id: 'b', title: '영양제', repeat: daily, series: 'a', due: '2026-11-22', done: false },
    { id: 'c', title: '물 마시기', repeat: daily, series: 'c', due: '2026-11-24', done: true, completedAt: '2026-11-24' },
    { id: 'd', title: '보고서', due: '2026-11-24', done: false },
    { id: 'e', title: '공과금', repeat: { freq: 'monthly', interval: 1 }, routine: false, due: '2026-11-24', done: false },
  ];
  const r = routinesToday(tasks, '2026-11-24');
  assert.deepEqual(r.map((t) => t.id), ['a', 'c']);
  // 다음 차례에도 루틴 표시가 이어져요
  const t = makeTask({ title: '스트레칭', due: '2026-11-24', repeat: daily, routine: true });
  assert.equal(nextRepeatTask(t, [t], '2026-11-24').routine, true);
});

test('반복 할일 첫 날: 규칙에 맞는 날로 (토요일에 만든 평일 루틴은 월요일부터)', async () => {
  const { makeTask } = await import('../js/tasks.js');
  const wk = { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] };
  assert.equal(makeTask({ title: '공복 유산균', due: '2026-11-28', repeat: wk }).due, '2026-11-30'); // 토 → 월
  assert.equal(makeTask({ title: 'a', due: '2026-11-27', repeat: wk }).due, '2026-11-27'); // 금요일은 그대로
  assert.equal(makeTask({ title: 'b', due: '2026-11-28', repeat: { freq: 'weekly', interval: 1, byday: [0] } }).due, '2026-11-29'); // 일요일마다
  assert.equal(makeTask({ title: 'c', due: '2026-11-28', repeat: { freq: 'monthly', interval: 1, day: 25 } }).due, '2026-12-25');
  assert.equal(makeTask({ title: 'd', due: '2026-11-28', repeat: { freq: 'daily', interval: 1 } }).due, '2026-11-28');
  assert.equal(makeTask({ title: 'e', due: '2026-11-28' }).due, '2026-11-28'); // 반복 아니면 그대로
});
