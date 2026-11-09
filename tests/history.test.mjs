import test from 'node:test';
import assert from 'node:assert/strict';
import { trend, makeEntry, sameEntry } from '../js/history.js';

const e = (net) => ({ net, savings: net, stocks: 0, homes: 0, debts: 0 });
const days = {
  '2025-03-31': e(100), '2025-12-30': e(200),
  '2026-10-01': e(300), '2026-10-31': e(310),
  '2026-11-01': e(320), '2026-11-08': e(330), '2026-11-09': e(345),
};
const today = new Date(2026, 10, 9);

test('일별: 최근 30일 기록만', () => {
  const t = trend(days, {}, 'day', today);
  assert.deepEqual(t.points.map((p) => p.key), ['2026-10-31', '2026-11-01', '2026-11-08', '2026-11-09']);
  assert.equal(t.change, 35);
  assert.equal(t.points[0].label, '10/31');
});

test('월별: 그달 마지막 기록, 최근 12개월', () => {
  const t = trend(days, {}, 'month', today);
  assert.deepEqual(t.points.map((p) => [p.key, p.net]), [['2025-12', 200], ['2026-10', 310], ['2026-11', 345]]);
  assert.equal(t.points[0].label, '25.12');
});

test('연도별: 그해 마지막 기록', () => {
  const t = trend(days, {}, 'year', today);
  assert.deepEqual(t.points.map((p) => [p.key, p.net]), [['2025', 200], ['2026', 345]]);
  assert.equal(t.change, 145);
});

test('예전 월별 기록은 그달 일별 기록이 없을 때만 채운다', () => {
  const t = trend({ '2026-11-09': e(345) }, { '2026-09': { net: 290 }, '2026-11': { net: 1 } }, 'month', today);
  assert.deepEqual(t.points.map((p) => [p.key, p.net]), [['2026-09', 290], ['2026-11', 345]]);
});

test('기록 한 줄 만들기와 비교', () => {
  const a = makeEntry({ net: 10.4, savings: 5, stocks: 2, homes: 9, debts: 6 });
  assert.deepEqual(a, { net: 10, savings: 7, stocks: 2, homes: 9, debts: 6 });
  assert.ok(sameEntry(a, { ...a }));
  assert.ok(!sameEntry(a, { ...a, net: 11 }));
});

test('하루 변화: 무엇 때문에 움직였는지 나눠 보기', async () => {
  const { diffOf, sinceLast } = await import('../js/history.js');
  const a = { key: '2026-11-08', label: '11/8', net: 1000, savings: 600, stocks: 200, homes: 900, debts: 500 };
  const b = { key: '2026-11-09', label: '11/9', net: 1080, savings: 690, stocks: 270, homes: 900, debts: 510 };
  const d = diffOf(a, b);
  assert.deepEqual([d.net, d.stocks, d.cash, d.homes, d.debts], [80, 70, 20, 0, 10]);
  const t = trend({ '2026-11-08': a, '2026-11-09': b }, {}, 'day', new Date(2026, 10, 9));
  assert.equal(t.points[1].diff.net, 80);
  assert.equal(t.points[0].diff, undefined);
  const s = sinceLast({ '2026-11-07': a, '2026-11-09': b }, '2026-11-09', b);
  assert.equal(s.prevKey, '2026-11-07');
  assert.equal(s.net, 80);
  assert.equal(sinceLast({ '2026-11-09': b }, '2026-11-09', b), null);
});
