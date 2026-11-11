// 매달 정해진 날짜에 나가는 돈(대출 상환, 고정지출)의 일정과 알림.
// 화면과 GitHub Actions 알림 스크립트가 함께 씁니다. 날짜는 시각 없이 '그날'로만 다룹니다.
import { currentPayment, loanBalance } from './projection.js?v=20261111s';
import { nextScheduled, ymd } from './schedule.js?v=20261111s';

const DAY = 86_400_000;

/** 시각을 버린 날짜 */
export function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** y년 m월(0부터)의 day일. 그 달에 없는 날(31일 등)이면 말일로 */
function dayIn(y, m, day) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}

/** from(포함) 이후 처음 오는 '매달 day일' */
export function nextDue(day, from) {
  const d = Number(day);
  if (!(d >= 1 && d <= 31)) return null;
  const f = dateOnly(from);
  const here = dayIn(f.getFullYear(), f.getMonth(), d);
  return here >= f ? here : dayIn(f.getFullYear(), f.getMonth() + 1, d);
}

export function daysBetween(from, to) {
  return Math.round((dateOnly(to) - dateOnly(from)) / DAY);
}

/** 앞으로 days일 안에 나갈 돈 (대출 상환 + 고정지출), 날짜순 */
export function upcoming(data, from, days = 31) {
  const out = [];
  const add = (type, item, amount, fixedDate) => {
    const date = fixedDate || nextDue(type === 'loan' ? item.payDay : item.day, from);
    if (!date) return;
    const dday = daysBetween(from, date);
    if (dday <= days) out.push({ type, id: item.id, name: item.name, amount, date, dday, account: item.account || '', exact: type === 'fixed' || !!fixedDate });
  };
  for (const l of data.debts || []) {
    if (loanBalance(l, from) <= 0 && !l.schedule?.length) continue;
    if (l.schedule?.length) {
      // 상환스케줄이 있으면 실제 출금일(영업일)과 그 회차 금액을 그대로 써요
      const r = nextScheduled(l.schedule, ymd(dateOnly(from)));
      if (r) { const [y, m, d] = r.date.split('-').map(Number); add('loan', l, r.payment, new Date(y, m - 1, d)); }
    } else add('loan', l, currentPayment(l, dateOnly(from)));
  }
  for (const f of data.fixed || []) if (f.active !== false) add('fixed', f, Number(f.amount) || 0);
  // 같은 날이면 대출 상환을 먼저
  return out.sort((a, b) => a.dday - b.dday || (a.type === b.type ? 0 : a.type === 'loan' ? -1 : 1) || a.name.localeCompare(b.name));
}

export const ALERT_DAYS = { loan: [5, 3, 1], fixed: [1] };

/** 오늘 보내야 할 알림 */
export function alertsFor(data, today) {
  return upcoming(data, today, 6).filter((u) => ALERT_DAYS[u.type].includes(u.dday));
}

const krw = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const md = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`;

export function alertText(a) {
  if (a.type === 'loan') return `${a.name} 상환 ${a.dday}일 전이에요. ${md(a.date)} ${a.exact ? '' : '약 '}${krw(a.amount)}${a.account ? ` (${a.account})` : ''}`;
  return `내일 ${a.name} ${krw(a.amount)}이 빠져나가요.${a.account ? ` (${a.account})` : ''}`;
}

/** 여러 알림을 휴대폰 알림 한 건으로 묶기 */
export function notificationFor(alerts) {
  if (!alerts.length) return null;
  if (alerts.length === 1) return { title: '차곡차곡', body: alertText(alerts[0]) };
  return { title: `차곡차곡 · 확인할 일정 ${alerts.length}건`, body: alerts.map(alertText).join('\n') };
}

/** 고정지출 요약: 월 합계, 이번 달 아직 안 나간 금액, 분류별 합계 */
export function fixedSummary(fixed, today) {
  const items = (fixed || []).filter((f) => f.active !== false);
  const total = items.reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const t = dateOnly(today);
  const remaining = items
    .filter((f) => dayIn(t.getFullYear(), t.getMonth(), Number(f.day) || 1) >= t)
    .reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const byCat = {};
  for (const f of items) byCat[f.category || '기타'] = (byCat[f.category || '기타'] || 0) + (Number(f.amount) || 0);
  const categories = Object.entries(byCat).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  return { total, remaining, categories, count: items.length };
}
