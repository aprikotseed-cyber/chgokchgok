// 일정(구글 캘린더)·할일(구글 태스크)을 앱에서 쓰기 좋게 다듬는 순수 함수들.
// 날짜 키는 'YYYY-MM-DD'(한국 기기 시간 기준)로 맞춰요.

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEK = '일월화수목금토';

/** 반려자 캘린더 기본 이름 (설정에서 바꿀 수 있어요) */
export const PARTNER_NAMES = ['내 캘린더'];

// ───── 일정 ─────

/** 구글 캘린더 일정 하나 → 앱용 */
export function normEvent(ev, cal = {}) {
  const allDay = !!ev.start?.date;
  const start = allDay ? fromKey(ev.start.date) : new Date(ev.start?.dateTime);
  // 종일 일정의 end.date는 '다음 날'이라서 하루 빼요
  const end = allDay ? addDays(fromKey(ev.end?.date || ev.start.date), -1) : new Date(ev.end?.dateTime || ev.start?.dateTime);
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    id: ev.id, calId: cal.id || '', calName: cal.summary || cal.name || '', color: cal.backgroundColor || cal.color || '',
    partner: !!cal.partner, title: ev.summary || '(제목 없음)', location: ev.location || '',
    allDay, startKey: dayKey(start), endKey: dayKey(end), time: allDay ? '' : hm(start), endTime: allDay ? '' : hm(end),
    link: ev.htmlLink || '',
  };
}

/** 그날 보여줄 일정: 종일·시간 순, 같은 시간이면 반려자 캘린더는 맨 뒤 */
export function eventsOn(events, key) {
  return (events || [])
    .filter((e) => e.startKey <= key && e.endKey >= key)
    .sort((a, b) => (a.partner - b.partner) || (b.allDay - a.allDay) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

/** from부터 days일 동안 일정이 있는 날만 [{key, label, events}] */
export function agendaDays(events, from, days = 14) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const key = dayKey(d);
    const list = eventsOn(events, key);
    if (list.length) out.push({ key, label: dayLabel(d, from), events: list });
  }
  return out;
}

/** '오늘 · 11월 9일 (월)', '내일 · …', '11월 12일 (목)' */
export function dayLabel(d, today) {
  const n = Math.round((dayKeyDate(d) - dayKeyDate(today)) / 86400000);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  return n === 0 ? `오늘 · ${base}` : n === 1 ? `내일 · ${base}` : base;
}
const dayKeyDate = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ───── 할일 ─────

/** 구글 태스크 하나 → 앱용. due는 날짜만 의미 있어요 (구글 태스크는 시간을 저장하지 않아요) */
export function normTask(t, listId = '') {
  return {
    id: t.id, listId, title: t.title || '(제목 없음)', notes: t.notes || '',
    due: t.due ? t.due.slice(0, 10) : '', done: t.status === 'completed',
    completedAt: t.completed ? t.completed.slice(0, 10) : '', updated: t.updated || '',
  };
}

/** 할일 묶기: 지난 할일 / 오늘 / 내일 / 이번 주(7일 안) / 나중에 / 날짜 없음 / 완료 */
export function groupTasks(tasks, todayKey) {
  const g = { overdue: [], today: [], tomorrow: [], week: [], later: [], nodate: [], done: [] };
  const tomorrow = dayKey(addDays(fromKey(todayKey), 1));
  const weekEnd = dayKey(addDays(fromKey(todayKey), 7));
  for (const t of tasks || []) {
    if (t.done) g.done.push(t);
    else if (!t.due) g.nodate.push(t);
    else if (t.due < todayKey) g.overdue.push(t);
    else if (t.due === todayKey) g.today.push(t);
    else if (t.due === tomorrow) g.tomorrow.push(t);
    else if (t.due <= weekEnd) g.week.push(t);
    else g.later.push(t);
  }
  const byDue = (a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title);
  for (const k of ['overdue', 'week', 'later']) g[k].sort(byDue);
  g.done.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return g;
}

/** 구글 태스크에 보낼 due 값 */
export const toTaskDue = (key) => (key ? `${key}T00:00:00.000Z` : undefined);

// ───── 빠른 입력: '내일 우유 사기', '금요일 보고서', '11/20 병원' ─────

/**
 * 할일 한 줄에서 날짜를 뽑고 나머지를 제목으로.
 * 요일만 말하면 이번 주(월~일)의 그 요일, '다음 주 ○요일'이면 다음 주. 날짜가 없으면 due 없음.
 */
export function parseQuickTask(text, now = new Date()) {
  let s = ` ${String(text || '').trim()} `;
  const today = dayKeyDate(now);
  let due = '';
  const take = (re, fn) => {
    if (due) return;
    const m = s.match(re);
    if (!m) return;
    const d = fn(m);
    if (d && !isNaN(d)) { due = dayKey(d); s = s.replace(m[0], ' '); }
  };
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const dayIdx = (ch) => '월화수목금토일'.indexOf(ch);
  take(/\s(오늘)(까지)?\s/, () => today);
  take(/\s(내일)(까지)?\s/, () => addDays(today, 1));
  take(/\s(모레)(까지)?\s/, () => addDays(today, 2));
  take(/\s(다음\s?주|담주)\s?([월화수목금토일])(요일)?(까지|에)?\s/, (m) => addDays(monday, 7 + dayIdx(m[2])));
  take(/\s(이번\s?주\s?)?([월화수목금토일])요일(까지|에)?\s/, (m) => addDays(monday, dayIdx(m[2])));
  take(/\s(\d{1,2})월\s?(\d{1,2})일(까지|에)?\s/, (m) => nearest(today, Number(m[1]), Number(m[2])));
  take(/\s(\d{1,2})[/.](\d{1,2})(까지|에)?\s/, (m) => nearest(today, Number(m[1]), Number(m[2])));
  const title = s.replace(/\s+/g, ' ').trim();
  return { title, due };
}

/** 월·일만 주어지면 올해, 이미 한참 지났으면(30일 넘게) 내년 */
function nearest(today, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let x = new Date(today.getFullYear(), m - 1, d);
  if (x < addDays(today, -30)) x = new Date(today.getFullYear() + 1, m - 1, d);
  return x;
}

/** 할일 날짜 보기 좋게: '오늘', '내일', '11월 20일 (금)', 지난 건 '3일 지남' */
export function dueLabel(key, todayKey) {
  if (!key) return '';
  const d = fromKey(key);
  const n = Math.round((d - fromKey(todayKey)) / 86400000);
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n < 0) return `${-n}일 지남`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}

// ───── 보여줄 일정 (앱·아침 브리핑·비서 공통) ─────

/** 캘린더별 보기·반려자 설정: 설정에서 바꾼 값(googleSettings.cals)이 우선 */
export const calPref = (c, gs = {}) => ({ show: gs.cals?.[c.id]?.show ?? c.show, partner: gs.cals?.[c.id]?.partner ?? c.partner });

/** 저장해 둔 agenda에서 숨긴 캘린더는 빼고, 반려자 표시는 지금 설정대로 */
export function visibleEvents(agenda, gs = {}) {
  if (!agenda) return [];
  const prefs = new Map((agenda.calendars || []).map((c) => [c.id, calPref(c, gs)]));
  return (agenda.events || []).filter((e) => prefs.get(e.calId)?.show !== false).map((e) => ({ ...e, partner: prefs.get(e.calId)?.partner ?? e.partner }));
}

/** 받아 둔 일정이 어느 날까지 있는지 (받은 날 + 31일) */
export function agendaUntil(agenda) {
  if (!agenda?.syncedAt) return '';
  const d = new Date(agenda.syncedAt);
  return dayKey(addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), 31));
}
