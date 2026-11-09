import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCalendar, parseEventInput } from '../js/agenda.js';

const now = new Date(2026, 10, 9, 10, 0); // 월
const cals = ['Work', 'Life', 'Exercise', 'Cherish', 'Birthday'].map((name) => ({ name }));
const kw = [{ word: '라스런', cal: 'Life' }, { word: '삼남매', cal: 'Cherish' }];

test('캘린더: 말한 이름이 먼저', () => {
  assert.deepEqual(pickCalendar('라이프에 금요일 7시 회의', cals), { text: '금요일 7시 회의', calName: 'Life' });
  assert.deepEqual(pickCalendar('Work 캘린더에 내일 상담', cals), { text: '내일 상담', calName: 'Work' });
  assert.deepEqual(pickCalendar('내일 3시 상담 work 캘린더에', cals), { text: '내일 3시 상담', calName: 'Work' });
  assert.equal(pickCalendar('내일 학교에 가기', cals).calName, ''); // 캘린더 이름이 아니면 그대로
});

test('캘린더: 나만의 낱말 → 기본 규칙', () => {
  assert.equal(parseEventInput('금요일 7시 라스런회의', now, cals, kw).calName, 'Life'); // '회의'여도 Life
  assert.equal(parseEventInput('토요일 삼남매 저녁', now, cals, kw).calName, 'Cherish');
  assert.equal(parseEventInput('목요일 협의회', now, cals, kw).calName, 'Work');
  const e = parseEventInput('라이프에 내일 오후 3시 학교 회의', now, cals, kw);
  assert.deepEqual([e.title, e.date, e.time, e.calName], ['학교 회의', '2026-11-10', '15:00', 'Life']);
});
