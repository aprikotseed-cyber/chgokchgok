import test from 'node:test';
import assert from 'node:assert/strict';
import { morningBriefing } from '../js/briefing.js';
import { normEvent, normTask } from '../js/agenda.js';

const today = new Date(2026, 10, 9); // 월
const agenda = {
  syncedAt: new Date(2026, 10, 8, 21).getTime(),
  calendars: [{ id: 'w', name: 'Work', show: true, partner: false }, { id: 'p', name: '내 캘린더', show: true, partner: true }, { id: 'h', name: '공휴일', show: false }],
  events: [
    normEvent({ id: '1', summary: '야근', start: { dateTime: new Date(2026, 10, 9, 20).toISOString() }, end: { dateTime: new Date(2026, 10, 9, 22).toISOString() } }, { id: 'p', summary: '내 캘린더', partner: true }),
    normEvent({ id: '2', summary: '학년 협의회', start: { dateTime: new Date(2026, 10, 9, 15).toISOString() }, end: { dateTime: new Date(2026, 10, 9, 16).toISOString() } }, { id: 'w', summary: 'Work' }),
    normEvent({ id: '3', summary: '숨긴 캘린더 일정', start: { date: '2026-11-09' }, end: { date: '2026-11-10' } }, { id: 'h', summary: '공휴일' }),
  ],
  tasks: [
    normTask({ id: 'a', title: '채점', due: '2026-11-09T00:00:00.000Z', status: 'needsAction' }),
    normTask({ id: 'b', title: '공문 회신', due: '2026-11-07T00:00:00.000Z', status: 'needsAction' }),
  ],
};
const data = {
  fixed: [{ id: 'f1', name: '넷플릭스', day: 9, amount: 17000, account: '신용카드' }, { id: 'f2', name: '관리비', day: 10, amount: 250000 }],
  debts: [{ id: 'd1', name: '신용대출', balance: 10_000_000, rate: 5, payDay: 14, payment: 300000, method: 'equal', maturity: '2030-01' }],
};

test('아침 브리핑: 오늘 일정·할일, 오늘 나가는 돈만', () => {
  const n = morningBriefing(data, agenda, today);
  assert.equal(n.title, '🗓️ 오늘의 아침 브리핑');
  const [ev, todo, late, money, ...rest] = n.body.split('\n');
  assert.equal(ev, '└ 일정 2️⃣ : 15:00 학년 협의회, 20:00 야근(반려자)');
  assert.equal(todo, '└ 할일 1️⃣ : 채점');
  assert.equal(late, '└ 지난 할일 : 1️⃣개 있어요. 참고!');
  assert.equal(money, '└ 오늘 출금 : 넷플릭스');
  assert.deepEqual(rest, []); // 관리비(내일)·대출(5일 뒤)은 넣지 않아요
});

test('아침 브리핑: 상환일 당일에는 상환도, 연결 전에는 돈 나가는 날만 보내요', () => {
  const d14 = new Date(2026, 10, 14);
  assert.equal(morningBriefing(data, null, d14).body, '└ 오늘 상환 : 신용대출');
  assert.equal(morningBriefing(data, null, new Date(2026, 10, 12)), null);
  assert.match(morningBriefing(data, { ...agenda, syncedAt: new Date(2026, 8, 1).getTime() }, today).body, /앱을 한 번 열면/);
});

test('숫자 이모지', async () => {
  const { numEmoji } = await import('../js/briefing.js');
  assert.deepEqual([0, 3, 10, 12].map(numEmoji), ['0️⃣', '3️⃣', '🔟', '1️⃣2️⃣']);
});
