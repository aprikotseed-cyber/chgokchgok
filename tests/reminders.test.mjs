import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDue, upcoming, alertsFor, notificationFor, fixedSummary, alertText } from '../js/reminders.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('다음 출금일: 오늘이면 오늘, 지났으면 다음 달, 31일은 말일로', () => {
  assert.deepEqual(nextDue(9, d(2026, 11, 9)), d(2026, 11, 9));
  assert.deepEqual(nextDue(5, d(2026, 11, 9)), d(2026, 12, 5));
  assert.deepEqual(nextDue(31, d(2026, 11, 9)), d(2026, 11, 30));
  assert.deepEqual(nextDue(31, d(2027, 2, 1)), d(2027, 2, 28));
  assert.deepEqual(nextDue(30, d(2026, 12, 31)), d(2027, 1, 30));
  assert.equal(nextDue('', d(2026, 11, 9)), null);
});

const data = {
  debts: [
    { id: 'd1', name: '보금자리론', balance: 1e8, rate: 4, method: 'annuity', maturity: '2046-11', payDay: 25 },
    { id: 'd2', name: '신용대출', balance: 0, rate: 5, method: 'equal', maturity: '2028-01', payDay: 14 },
    { id: 'd3', name: '상환일 없음', balance: 1e7, rate: 5, method: 'equal', maturity: '2028-01' },
  ],
  fixed: [
    { id: 'f1', name: '통신비', amount: 55_000, day: 10, category: '통신' },
    { id: 'f2', name: '관리비', amount: 230_000, day: 25, category: '주거' },
    { id: 'f3', name: '쉬는 구독', amount: 9_900, day: 10, category: '구독', active: false },
  ],
};

test('대출 상환은 5·3·1일 전, 고정지출은 1일 전에만 알림', () => {
  const on = (day) => alertsFor(data, d(2026, 11, day)).map((a) => `${a.id}:${a.dday}`);
  assert.deepEqual(on(20), ['d1:5']);
  assert.deepEqual(on(21), []);
  assert.deepEqual(on(22), ['d1:3']);
  assert.deepEqual(on(24), ['d1:1', 'f2:1']);
  assert.deepEqual(on(9), ['f1:1']); // 쉬는 구독(f3)·잔액 0원 대출·상환일 없는 대출은 제외
});

test('알림 문구와 묶음', () => {
  const alerts = alertsFor(data, d(2026, 11, 24));
  const n = notificationFor(alerts);
  assert.match(n.title, /2건/);
  assert.match(n.body, /보금자리론 상환 1일 전이에요\. 11월 25일 약 [\d,]+원/);
  assert.match(n.body, /내일 관리비 230,000원이 빠져나가요/);
  assert.equal(notificationFor([]), null);
  assert.match(alertText(alertsFor(data, d(2026, 11, 9))[0]), /^내일 통신비 55,000원/);
});

test('다가오는 일정은 날짜순', () => {
  const u = upcoming(data, d(2026, 11, 9), 31);
  assert.deepEqual(u.map((x) => x.id), ['f1', 'd1', 'f2']);
  assert.equal(u[0].dday, 1);
});

test('고정지출 합계와 이번 달 남은 금액', () => {
  const s = fixedSummary(data.fixed, d(2026, 11, 12));
  assert.equal(s.total, 285_000);
  assert.equal(s.remaining, 230_000); // 10일 통신비는 이미 나감
  assert.equal(s.count, 2);
  assert.deepEqual(s.categories.map((c) => c.name), ['주거', '통신']);
});
