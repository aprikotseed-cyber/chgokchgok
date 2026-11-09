import test from 'node:test';
import assert from 'node:assert/strict';
import { normEvent, eventsOn, agendaDays, normTask, groupTasks, parseQuickTask, dueLabel, toTaskDue } from '../js/agenda.js';

const now = new Date(2026, 10, 9, 10, 0); // 2026-11-09 (월) 오전 10시

test('구글 일정: 종일(끝 날짜는 다음 날이라 하루 빼기)과 시간 일정', () => {
  const a = normEvent({ id: 'a', summary: '연수', start: { date: '2026-11-12' }, end: { date: '2026-11-14' } }, { id: 'w', summary: 'Work', backgroundColor: '#f00' });
  assert.deepEqual([a.allDay, a.startKey, a.endKey, a.calName], [true, '2026-11-12', '2026-11-13', 'Work']);
  const b = normEvent({ id: 'b', summary: '헬스', start: { dateTime: new Date(2026, 10, 9, 19, 30).toISOString() }, end: { dateTime: new Date(2026, 10, 9, 20, 30).toISOString() } }, { id: 'e', summary: 'Exercise' });
  assert.deepEqual([b.allDay, b.startKey, b.time, b.endTime], [false, '2026-11-09', '19:30', '20:30']);
});

test('하루 일정 순서: 종일 먼저, 시간순, 반려자 캘린더는 맨 뒤', () => {
  const ev = [
    normEvent({ id: '1', summary: '저녁 약속', start: { dateTime: new Date(2026, 10, 9, 18).toISOString() }, end: { dateTime: new Date(2026, 10, 9, 20).toISOString() } }, { id: 'p', summary: '내 캘린더', partner: true }),
    normEvent({ id: '2', summary: '회의', start: { dateTime: new Date(2026, 10, 9, 15).toISOString() }, end: { dateTime: new Date(2026, 10, 9, 16).toISOString() } }, { id: 'w' }),
    normEvent({ id: '3', summary: '생일', start: { date: '2026-11-09' }, end: { date: '2026-11-10' } }, { id: 'b' }),
    normEvent({ id: '4', summary: '아침 운동', start: { dateTime: new Date(2026, 10, 9, 7).toISOString() }, end: { dateTime: new Date(2026, 10, 9, 8).toISOString() } }, { id: 'e' }),
  ];
  assert.deepEqual(eventsOn(ev, '2026-11-09').map((e) => e.id), ['3', '4', '2', '1']);
  const days = agendaDays(ev, now, 14);
  assert.equal(days.length, 1);
  assert.equal(days[0].label, '오늘 · 11월 9일 (월)');
});

test('할일 묶기', () => {
  const t = [
    { id: 'a', title: '지난 일', due: '2026-11-07' }, { id: 'b', title: '오늘 일', due: '2026-11-09' },
    { id: 'c', title: '내일 일', due: '2026-11-10' }, { id: 'd', title: '금요일 일', due: '2026-11-13' },
    { id: 'e', title: '다음 달', due: '2026-12-20' }, { id: 'f', title: '언젠가', due: '' },
    { id: 'g', title: '끝낸 일', due: '2026-11-08', done: true, completedAt: '2026-11-08' },
  ];
  const g = groupTasks(t, '2026-11-09');
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.id)])),
    { overdue: ['a'], today: ['b'], tomorrow: ['c'], week: ['d'], later: ['e'], nodate: ['f'], done: ['g'] });
  assert.equal(normTask({ id: 'x', title: '우유', due: '2026-11-10T00:00:00.000Z', status: 'needsAction' }).due, '2026-11-10');
  assert.equal(toTaskDue('2026-11-10'), '2026-11-10T00:00:00.000Z');
});

test('빠른 입력: 날짜 말을 빼고 제목만, 요일만 말하면 이번 주', () => {
  const p = (s) => parseQuickTask(s, now);
  assert.deepEqual(p('내일 우유 사기'), { title: '우유 사기', due: '2026-11-10' });
  assert.deepEqual(p('금요일 보고서 제출'), { title: '보고서 제출', due: '2026-11-13' });
  assert.deepEqual(p('보고서 금요일까지'), { title: '보고서', due: '2026-11-13' });
  assert.deepEqual(p('다음주 화요일 학부모 상담'), { title: '학부모 상담', due: '2026-11-17' });
  assert.deepEqual(p('11/20 병원 예약'), { title: '병원 예약', due: '2026-11-20' });
  assert.deepEqual(p('12월 3일 연수 신청'), { title: '연수 신청', due: '2026-12-03' });
  assert.deepEqual(p('1월 5일 자동차 보험'), { title: '자동차 보험', due: '2027-01-05' });
  assert.deepEqual(p('책 반납'), { title: '책 반납', due: '' });
  assert.equal(p('월요일 회의').due, '2026-11-09'); // 오늘이 월요일
});

test('할일 날짜 표시', () => {
  assert.equal(dueLabel('2026-11-09', '2026-11-09'), '오늘');
  assert.equal(dueLabel('2026-11-10', '2026-11-09'), '내일');
  assert.equal(dueLabel('2026-11-06', '2026-11-09'), '3일 지남');
  assert.equal(dueLabel('2026-11-13', '2026-11-09'), '11월 13일 (금)');
});

test('할일 시간: 제목에서 빼고 메모 첫 줄로 (구글 태스크는 시간을 못 받아요)', async () => {
  const { taskNotes } = await import('../js/agenda.js');
  assert.deepEqual(parseQuickTask('모레 오후 3시 특별중도해지', now), { title: '특별중도해지', due: '2026-11-11', time: '15:00' });
  assert.deepEqual(parseQuickTask('3시간 공부하기', now), { title: '3시간 공부하기', due: '' }); // '3시간'은 시간이 아니에요
  assert.equal(taskNotes('서류 챙기기', '15:00'), '시간 15:00\n서류 챙기기');
  const t = normTask({ id: 'a', title: '특별중도해지', notes: '시간 15:00\n서류 챙기기', due: '2026-11-11T00:00:00.000Z', status: 'needsAction' });
  assert.deepEqual([t.time, t.notes], ['15:00', '서류 챙기기']);
  const g = groupTasks([{ id: '1', title: 'B', due: '2026-11-09', time: '' }, { id: '2', title: 'A', due: '2026-11-09', time: '09:00' }], '2026-11-09');
  assert.deepEqual(g.today.map((x) => x.id), ['2', '1']); // 시간 있는 것 먼저
});
