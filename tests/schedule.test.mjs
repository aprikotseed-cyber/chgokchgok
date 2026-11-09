import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, scheduleBalanceAt, nextScheduled } from '../js/schedule.js';
import { currentTotals, currentPayment, project } from '../js/projection.js';
import { upcoming, alertsFor } from '../js/reminders.js';
import { scheduleRecords, yearlySummary } from '../js/records.js';

// 주택금융공사 상환스케줄(.xls로 받지만 내용은 HTML 표)과 같은 모양의 가짜 데이터
const tr = (cells, tag = 'td') => `<tr>${cells.map((c) => `<${tag} style="mso-number-format:'\\@'">${c}</${tag}>`).join('')}</tr>`;
const rows = [
  ['1', '2026-12-17', '2026-12-17', '1,000,000', '0', '1,000,000', '10,000,000'],
  ['2', '2027-01-17', '2027-01-18', '1,100,000', '1,000,000', '100,000', '9,000,000'],
  ['3', '2027-02-17', '2027-02-17', '1,100,874', '1,010,000', '90,874', '7,990,000'],
  ['4', '2027-03-17', '2027-03-17', '8,050,000', '7,990,000', '60,000', '0'],
];
const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table>
  <tr><th rowspan="2">회차</th><th colspan="2">상환예정일자</th><th colspan="4">상환예정금액</th><th colspan="2">구간별 이자계산</th></tr>
  ${tr(['일자', '영업일자', '원리금', '원금', '이자', '상환후 예정잔액', '시작일자', '종료일자'], 'th')}
  ${rows.map((r) => tr([...r, '2026-10-26', '2026-12-16'])).join('')}
  ${tr(['합계', '-', '-', '11,250,874', '10,000,000', '1,250,874', '-', '-', '-'])}
</table></body></html>`;

test('HTML 표 형식 상환스케줄을 읽는다 (합계 줄 제외, 영업일을 출금일로)', () => {
  const s = parseSchedule(html);
  assert.equal(s.rows.length, 4);
  assert.deepEqual(s.rows[1], { n: 2, due: '2027-01-17', date: '2027-01-18', payment: 1_100_000, principal: 1_000_000, interest: 100_000, balance: 9_000_000 });
  assert.equal(s.total.principal, 10_000_000);
});

test('CSV 형식도 읽는다', () => {
  const csv = ['회차,일자,영업일자,원리금,원금,이자,상환후 예정잔액', ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
  const s = parseSchedule(csv);
  assert.equal(s.rows.length, 4);
  assert.equal(s.rows[3].principal, 7_990_000);
});

test('표가 없으면 알기 쉬운 오류', () => {
  assert.throws(() => parseSchedule('<html><table><tr><td>안내문</td></tr></table></html>'), /회차/);
});

const schedule = parseSchedule(html).rows;
const loan = { id: 'd1', name: '보금자리론', schedule, balance: 999, rate: 4, method: 'graduated', maturity: '2027-03' };

test('잔액·다음 납입은 스케줄을 따른다 (입력한 잔액은 무시)', () => {
  assert.equal(scheduleBalanceAt(schedule, '2026-11-09'), 10_000_000);
  assert.equal(scheduleBalanceAt(schedule, '2027-01-17'), 10_000_000); // 영업일(18일) 전이면 아직 안 빠져나감
  assert.equal(scheduleBalanceAt(schedule, '2027-01-18'), 9_000_000);
  assert.equal(nextScheduled(schedule, '2026-12-18').n, 2);
  assert.equal(currentTotals({ debts: [loan] }, {}, new Date(2027, 0, 20)).debts, 9_000_000);
  assert.equal(currentPayment(loan, new Date(2027, 0, 20)), 1_100_874);
});

test('연도별 예상도 스케줄 잔액 그대로', () => {
  const { points } = project({ debts: [loan] }, {}, { years: 2, now: new Date(2026, 10, 9) });
  assert.deepEqual(points.map((p) => p.debts), [10_000_000, 10_000_000, 0]);
});

test('알림은 스케줄의 실제 출금일(영업일) 기준', () => {
  const u = upcoming({ debts: [loan] }, new Date(2027, 0, 1), 31);
  assert.equal(u[0].date.getDate(), 18);
  assert.equal(u[0].amount, 1_100_000);
  assert.deepEqual(alertsFor({ debts: [loan] }, new Date(2027, 0, 13)).map((a) => a.dday), [5]);
});

test('이미 낸 회차는 상환 기록으로 자동 집계', () => {
  const recs = scheduleRecords({ debts: [loan] }, '2027-02-17');
  assert.equal(recs.length, 3);
  const y = yearlySummary(recs);
  assert.equal(y.find((x) => x.year === '2027').principal, 2_010_000);
  assert.equal(y.find((x) => x.year === '2026').interest, 1_000_000);
});
