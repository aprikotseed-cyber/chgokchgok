import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAgenda } from '../js/agenda.js';
import { createDemoGoogle } from '../js/google-demo.js';

test('구글에서 받아 오기: 기본 캘린더 고르기·반려자·설정 반영 (앱·GitHub 공통)', async () => {
  const g = createDemoGoogle();
  g.calendars = async () => [
    ...(await createDemoGoogle().calendars()),
    { id: 'holiday', summary: '대한민국의 휴일', accessRole: 'reader' },
  ];
  const a = await fetchAgenda(g, {}, new Date());
  const cal = (id) => a.calendars.find((c) => c.id === id);
  assert.equal(cal('work').show, true);
  assert.equal(cal('holiday').show, false); // 기본 5개 + 내 캘린더만
  assert.equal(cal('partner').partner, true);
  assert.equal(cal('holiday').write, false);
  assert.ok(a.events.some((e) => e.title === '야근' && e.partner));
  assert.ok(a.tasks.length > 0 && a.listId === 'default');
  // 설정에서 Work를 숨기면 받지 않아요
  const b = await fetchAgenda(g, { cals: { work: { show: false } } }, new Date());
  assert.ok(!b.events.some((e) => e.calId === 'work'));
});
