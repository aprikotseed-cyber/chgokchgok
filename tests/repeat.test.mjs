import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickTask, parseQuickEvent, nextOccurrence, toRRule, repeatLabel, ruleFromChoice, choiceOf, toGoogleEvent } from '../js/agenda.js';

const now = new Date(2026, 10, 9, 10, 0); // 2026-11-09 (월)

test('반복 빠른 입력: 할일', () => {
  const a = parseQuickTask('매주 토요일 화장실 청소', now);
  assert.deepEqual([a.title, a.due, a.repeat.freq, a.repeat.byday], ['화장실 청소', '2026-11-14', 'weekly', [6]]);
  assert.equal(repeatLabel(a.repeat), '매주 토요일');
  const b = parseQuickTask('평일마다 출석부 확인', now);
  assert.deepEqual([b.title, b.due, repeatLabel(b.repeat)], ['출석부 확인', '2026-11-09', '평일마다']);
  const c = parseQuickTask('매월 25일 관리비 확인', now);
  assert.deepEqual([c.title, c.due, repeatLabel(c.repeat)], ['관리비 확인', '2026-11-25', '매월 25일']);
  const d = parseQuickTask('매주 월수금 영양제', now);
  assert.deepEqual([d.due, repeatLabel(d.repeat)], ['2026-11-09', '매주 월·수·금요일']);
  const e = parseQuickTask('격주 수요일 분리수거', now);
  assert.deepEqual([e.title, e.due, repeatLabel(e.repeat)], ['분리수거', '2026-11-11', '2주마다 수요일']);
  assert.equal(parseQuickTask('우유 사기', now).repeat, undefined);
});

test('다음 차례', () => {
  const w = parseQuickTask('매주 토요일 청소', now).repeat;
  assert.equal(nextOccurrence(w, '2026-11-14'), '2026-11-21');
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1, byday: [1, 3, 5] }, '2026-11-13'), '2026-11-16');
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 2, byday: [3], anchor: '2026-11-11' }, '2026-11-11'), '2026-11-25');
  assert.equal(nextOccurrence({ freq: 'monthly', interval: 1, day: 31 }, '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-11-30'), '2026-12-01');
  assert.equal(nextOccurrence({ freq: 'yearly', interval: 1, anchor: '2026-11-18' }, '2026-11-18'), '2027-11-18');
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1, until: '2026-11-30' }, '2026-11-30'), '');
});

test('일정 반복: 빠른 입력과 구글 캘린더 규칙', () => {
  const ev = parseQuickEvent('매주 화요일 7시 헬스', now);
  assert.deepEqual([ev.title, ev.date, ev.time], ['헬스', '2026-11-10', '19:00']);
  assert.equal(toRRule(ev.repeat), 'RRULE:FREQ=WEEKLY;BYDAY=TU');
  assert.deepEqual(toGoogleEvent({ ...ev }).recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU']);
  assert.equal(toRRule({ freq: 'monthly', interval: 1, day: 25, until: '2027-06-30' }), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=25;UNTIL=20270630');
  assert.deepEqual(ruleFromChoice('weekly', '2026-11-14'), { freq: 'weekly', interval: 1, byday: [6], anchor: '2026-11-14' });
  assert.equal(choiceOf(ruleFromChoice('biweekly', '2026-11-14')), 'biweekly');
  assert.equal(choiceOf({ freq: 'weekly', interval: 1, byday: [1, 3, 5] }), 'keep');
});

test('늦게 끝내도 다음 차례는 오늘 이후', async () => {
  const { nextFrom } = await import('../js/agenda.js');
  const w = { freq: 'weekly', interval: 1, byday: [6] };
  assert.equal(nextFrom(w, '2026-10-31', '2026-11-09'), '2026-11-14'); // 10/31(토) 할일을 11/9에 끝냄
  assert.equal(nextFrom(w, '2026-11-14', '2026-11-09'), '2026-11-21');
});

import { nextTaskDate, parseQuickTask as pqt } from '../js/agenda.js';
test('반복 할일: 다음 차례를 중복으로 만들지 않아요', () => {
  const rule = { freq: 'weekly', interval: 1, byday: [1, 4] }; // 월·목
  const T = (id, due, done = false) => ({ id, title: '영어공부', due, done });
  // 월(9일)을 목(12일)에 끝냈는데 12일 것이 이미 있으면 새로 만들지 않아요
  assert.equal(nextTaskDate(rule, T('a', '2026-11-09', true), [T('a', '2026-11-09', true), T('b', '2026-11-12')], '2026-11-12'), '');
  // 12일 것을 먼저 끝내고(→16일 생김) 9일 것을 나중에 끝내도 12일이 또 생기지 않아요
  assert.equal(nextTaskDate(rule, T('a', '2026-11-09', true), [T('b', '2026-11-12', true), T('c', '2026-11-16')], '2026-11-12'), '');
  // 다음 차례가 없으면 가장 늦은 날짜 다음부터
  assert.equal(nextTaskDate(rule, T('a', '2026-11-09', true), [T('b', '2026-11-12', true)], '2026-11-12'), '2026-11-16');
  assert.equal(nextTaskDate(rule, T('b', '2026-11-12', true), [], '2026-11-12'), '2026-11-16');
});
test("'매주 월, 목요일'·'매주 월요일, 목요일'도 두 요일 반복", () => {
  const now = new Date(2026, 10, 12, 9);
  for (const q of ['매주 월, 목요일 저녁 9시 영어공부', '매주 월요일, 목요일 오후 9시 영어공부', '매주 월·목 21시 영어공부']) {
    const r = pqt(q, now);
    assert.equal(r.title, '영어공부', q);
    assert.deepEqual(r.repeat.byday, [1, 4], q);
    assert.equal(r.time, '21:00', q);
  }
  assert.deepEqual(pqt('매주 일요일 청소', now).repeat.byday, [0]);
  assert.deepEqual(pqt('매주 월요일 회의', now).repeat.byday, [1]); // '요일'의 '일'을 일요일로 세지 않아요
});
