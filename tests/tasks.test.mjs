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
