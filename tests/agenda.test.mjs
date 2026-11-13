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

test('할일: 시간은 알아듣되, 구글 태스크에 실제로 있는 것만 보여줘요 (메모를 시간으로 해석하지 않아요)', () => {
  assert.deepEqual(parseQuickTask('모레 오후 3시 특별중도해지', now), { title: '특별중도해지', due: '2026-11-11', time: '15:00' });
  assert.deepEqual(parseQuickTask('3시간 공부하기', now), { title: '3시간 공부하기', due: '' }); // '3시간'은 시간이 아니에요
  assert.deepEqual(parseQuickTask("'귀 세척' 내일", now), { title: '귀 세척', due: '2026-11-10' }); // 따옴표는 빼요
  const t = normTask({ id: 'a', title: '특별중도해지', notes: '시간 15:00\n서류 챙기기', due: '2026-11-11T00:00:00.000Z', status: 'needsAction' });
  assert.deepEqual([t.time, t.notes], ['', '시간 15:00\n서류 챙기기']);
});

test('날짜: 일만 쓰면 이번 달(지났으면 다음 달), N일 뒤', () => {
  assert.deepEqual(parseQuickTask('26일 동학년회식', now), { title: '동학년회식', due: '2026-11-26' });
  assert.deepEqual(parseQuickTask('5일 관리비', now), { title: '관리비', due: '2026-12-05' });
  assert.deepEqual(parseQuickTask('3일 뒤 서류 제출', now), { title: '서류 제출', due: '2026-11-12' });
  assert.deepEqual(parseQuickTask('3일간 연수 정리', now), { title: '3일간 연수 정리', due: '' });
});

import { todayTasks as tt, normTask as nt } from '../js/agenda.js';
test('홈 오늘 할일: 오늘 끝낸 일도 체크된 채로, 자리는 그대로', () => {
  const T = (id, due, done = false, completedAt = '') => ({ id, title: id, due, done, completedAt, time: '' });
  const list = tt([T('a', '2026-11-11'), T('b', '2026-11-11', true, '2026-11-11'), T('c', '2026-11-09', true, '2026-11-11'), T('d', '2026-11-08', true, '2026-11-08'), T('e', '2026-11-12'), T('f', '2026-11-10'),
    T('g', '2026-11-17', true, '2026-11-11'), T('h', '', true, '2026-11-11')], '2026-11-11');
  assert.deepEqual(list.map((x) => x.id), ['c', 'f', 'a', 'b']); // 17일 마감을 미리 끝낸 g, 날짜 없는 h는 오늘 목록에 없어요
});
test('완료 시각은 이 기기 날짜로', () => {
  const d = new Date(2026, 10, 11, 7, 10); // 이 기기 시간 아침 7시 10분
  assert.equal(nt({ id: 'x', status: 'completed', completed: d.toISOString() }).completedAt, '2026-11-11');
});

import { parseEventInput, pickLocation } from '../js/agenda.js';
test('일정의 장소: "장소는 …"을 장소 칸으로', () => {
  const now = new Date('2026-11-13T10:00:00+09:00');
  const cals = [{ name: 'Life' }, { name: 'Work' }];
  const p = parseEventInput('11월 19일 오후 5시~6시반 대학원 수업 . 장소는 본관 201호', now, cals);
  assert.equal(p.title, '대학원 수업');
  assert.equal(p.location, '본관 201호');
  assert.equal(p.time, '17:00');
  assert.equal(p.endTime, '18:30');
  assert.equal(p.calName, 'Life');
  assert.equal(parseEventInput('내일 3시 회의, 장소: 3층 회의실이야', now, cals).location, '3층 회의실');
  assert.equal(pickLocation('금요일 헬스 장소는 판교 헬스장으로 넣어줘').location, '판교 헬스장');
  assert.equal(parseEventInput('토요일 점심 약속', now, cals).location, undefined);
});
