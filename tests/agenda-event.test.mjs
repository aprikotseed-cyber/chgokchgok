import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEvent, classifyEvent, toGoogleEvent, eventLine } from '../js/agenda.js';

const now = new Date(2026, 10, 9, 10, 0); // 2026-11-09 (월)
const p = (s) => parseQuickEvent(s, now);

test('일정 빠른 입력: 날짜·시간 뽑기', () => {
  assert.deepEqual(p('금요일 7시 헬스'), { title: '헬스', date: '2026-11-13', time: '19:00', endTime: '20:00', allDay: false });
  assert.deepEqual(p('다음주 수요일 3시~4시 반 학부모 상담'), { title: '학부모 상담', date: '2026-11-18', time: '15:00', endTime: '16:30', allDay: false });
  assert.deepEqual(p('11/20 병원'), { title: '병원', date: '2026-11-20', time: '', endTime: '', allDay: true });
  assert.deepEqual(p('내일 오전 10시 30분에 치과'), { title: '치과', date: '2026-11-10', time: '10:30', endTime: '11:30', allDay: false });
  assert.deepEqual(p('토요일 19:30 영화'), { title: '영화', date: '2026-11-14', time: '19:30', endTime: '20:30', allDay: false });
  assert.deepEqual(p('아침 7시 러닝'), { title: '러닝', date: '', time: '07:00', endTime: '08:00', allDay: false });
  assert.equal(p('12월 3일 저녁 6시부터 9시까지 송년회').endTime, '21:00');
});

test('캘린더 고르기', () => {
  assert.equal(classifyEvent('헬스'), 'Exercise');
  assert.equal(classifyEvent('뮤지컬 관람'), 'Cherish');
  assert.equal(classifyEvent('어머니 생신'), 'Birthday');
  assert.equal(classifyEvent('디지털 교육 연수'), 'Work');
  assert.equal(classifyEvent('대학원 수업'), 'Life'); // 대학원은 Work가 아니라 Life
  assert.equal(classifyEvent('자동차 정기검사'), 'Life');
});

test('구글 캘린더로 보낼 모양', () => {
  assert.deepEqual(toGoogleEvent({ title: '연수', date: '2026-11-12', endDate: '2026-11-13', allDay: true }),
    { summary: '연수', start: { date: '2026-11-12' }, end: { date: '2026-11-14' } });
  assert.deepEqual(toGoogleEvent({ title: '헬스', date: '2026-11-13', time: '19:00', endTime: '', allDay: false }),
    { summary: '헬스', start: { dateTime: '2026-11-13T19:00:00', timeZone: 'Asia/Seoul' }, end: { dateTime: '2026-11-13T20:00:00', timeZone: 'Asia/Seoul' } });
  assert.equal(eventLine({ title: '헬스', date: '2026-11-13', time: '19:00', endTime: '20:00' }), '11월 13일 (금) 19:00~20:00 헬스');
});
