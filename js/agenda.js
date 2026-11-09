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
    link: ev.htmlLink || '', recurring: !!ev.recurringEventId, notes: ev.description || '',
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
    due: t.due ? t.due.slice(0, 10) : '', done: t.status === 'completed', deleted: !!t.deleted,
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
export const calPref = (c, gs = {}) => {
  const p = gs.cals?.[c.id] || {};
  // 숨긴 캘린더는 설정 목록에서도 빠지고, 일정도 보여주지 않아요
  return { show: p.hidden ? false : p.show ?? c.show, partner: p.partner ?? c.partner, hidden: !!p.hidden };
};

/** 저장해 둔 agenda에서 숨긴 캘린더는 빼고, 반려자 표시는 지금 설정대로 */
export function visibleEvents(agenda, gs = {}) {
  if (!agenda) return [];
  const prefs = new Map((agenda.calendars || []).map((c) => [c.id, calPref(c, gs)]));
  return (agenda.events || []).filter((e) => prefs.get(e.calId)?.show !== false).map((e) => ({ ...e, partner: prefs.get(e.calId)?.partner ?? e.partner }));
}

/** 받아 둔 일정이 어느 날까지 있는지 (예전 저장분은 받은 날 + 31일) */
export function agendaUntil(agenda) {
  if (agenda?.until) return agenda.until;
  if (!agenda?.syncedAt) return '';
  const d = new Date(agenda.syncedAt);
  return dayKey(addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), 31));
}

// ───── 일정 빠른 입력: '금요일 7시 헬스', '다음주 수요일 3시~4시 반 상담', '11/20 병원' ─────
const T = '(오전|오후|아침|낮|저녁|밤|새벽)?\\s?(\\d{1,2})(?::(\\d{2})|시(?:\\s?(\\d{1,2})분|\\s?(반))?)';
const TIME_RE = new RegExp(`\\s${T}(?:\\s?(?:~|-|부터)\\s?${T}(?:까지)?)?(?:에|부터)?\\s`);

/** '오후' 3, '30' → '15:30'. 오전·오후를 안 쓰면 1~7시는 오후로 봐요 (3시 상담 → 15시) */
function toHM(ampm, h, colonMin, min, half, plain = true) {
  let hh = Number(h);
  const mm = Number(colonMin || min || (half ? 30 : 0));
  if (hh > 24 || mm > 59) return null;
  if (/오후|저녁|밤/.test(ampm || '') && hh < 12) hh += 12;
  else if (ampm === '낮' && hh <= 6) hh += 12;
  else if (/오전|아침|새벽/.test(ampm || '') && hh === 12) hh = 0;
  else if (!ampm && plain && hh >= 1 && hh <= 7) hh += 12;
  return hh * 60 + mm;
}
const hm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

/**
 * 일정 한 줄 → {title, date, time, endTime, allDay}.
 * 시간을 안 쓰면 종일, 날짜를 안 쓰면 date가 ''(부르는 쪽에서 오늘로), 요일만 쓰면 이번 주.
 */
export function parseQuickEvent(text, now = new Date()) {
  let s = ` ${String(text || '').trim()} `;
  let time = '';
  let endTime = '';
  const m = s.match(TIME_RE);
  if (m) {
    const a = toHM(m[1], m[2], m[3], m[4], m[5]);
    let b = m[7] ? toHM(m[6] || m[1], m[7], m[8], m[9], m[10], false) : null;
    if (a != null) {
      if (b != null && !m[6] && b <= a && b + 720 > a) b += 720; // '3시~5시' → 15~17시
      time = hm(a);
      endTime = hm(b != null && b > a ? b : Math.min(a + 60, 23 * 60 + 59));
      s = s.replace(m[0], ' ');
    }
  }
  const { title, due } = parseQuickTask(s, now);
  return { title, date: due, time, endTime, allDay: !time };
}

/** 캘린더 고르기 (덕준님 기준): 생일 → Birthday, 대학원 → Life, 운동 → Exercise, 공연·영화·전시 → Cherish, 학교·업무·연수 → Work, 나머지 → Life */
const CAL_RULES = [
  ['Birthday', /생일|생신|탄신/],
  ['Life', /대학원|논문|지도교수/],
  ['Exercise', /운동|헬스|러닝|달리기|조깅|요가|필라테스|수영|등산|pt|자전거|클라이밍|테니스|골프|배드민턴|스트레칭|마라톤|축구|농구|볼링/i],
  ['Cherish', /공연|영화|전시|콘서트|뮤지컬|연극|미술관|박물관|페스티벌|팬미팅|오페라|발레/],
  ['Work', /학교|업무|회의|협의|연수|출장|상담|학부모|교무|공문|교육청|수업|평가|채점|현장체험|졸업식|입학식|방학식|개학|학년|담임|교직원|직원|워크숍|세미나|당직/],
];
export function classifyEvent(title) {
  for (const [cal, re] of CAL_RULES) if (re.test(title)) return cal;
  return 'Life';
}

/** 앱 일정 → 구글 캘린더 일정 (한국 시간) */
export function toGoogleEvent({ title, date, endDate, allDay, time, endTime, location, notes }) {
  const body = { summary: title };
  if (location !== undefined) body.location = location;
  if (notes !== undefined) body.description = notes;
  if (allDay || !time) {
    const last = endDate && endDate > date ? endDate : date;
    body.start = { date };
    body.end = { date: dayKey(addDays(fromKey(last), 1)) }; // 구글은 끝 날짜를 '다음 날'로 받아요
  } else {
    let end = endTime && endTime > time ? endTime : hm(Math.min(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + 60, 23 * 60 + 59));
    body.start = { dateTime: `${date}T${time}:00`, timeZone: 'Asia/Seoul' };
    body.end = { dateTime: `${date}T${end}:00`, timeZone: 'Asia/Seoul' };
  }
  return body;
}

/** 일정 한 줄 요약: '11월 13일 (금) 19:00~20:00 헬스' */
export function eventLine(e) {
  const d = fromKey(e.date || e.startKey);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
  return `${base} ${e.allDay ? '종일' : `${e.time}~${e.endTime}`} ${e.title}`;
}

// ───── 구글에서 일정·할일 받아 오기 (앱과 GitHub 자동 동기화가 같이 써요) ─────
const DEFAULT_CALS = ['exercise', 'cherish', 'birthday', 'work', 'life', ...PARTNER_NAMES];

/**
 * g: {calendars, events, taskLists, tasks} (google.js의 목록 함수들), gs: settings.google
 * 어제 ~ 32일 뒤 일정, 고른 목록의 할일(완료는 최근 30일)
 */
export async function fetchAgenda(g, gs = {}, now = new Date(), interactive = false) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 달력으로 넘겨 볼 수 있게: 지난달 1일 ~ 다다음 달 말일
  const from = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const to = new Date(t.getFullYear(), t.getMonth() + 3, 1);
  const raw = await g.calendars(interactive);
  const nameOf = (c) => c.summaryOverride || c.summary || '';
  const named = raw.some((c) => DEFAULT_CALS.includes(nameOf(c).toLowerCase()));
  const calendars = raw.map((c) => {
    const name = nameOf(c);
    return { id: c.id, name, color: c.backgroundColor || '', primary: !!c.primary, write: ['owner', 'writer'].includes(c.accessRole),
      show: named ? DEFAULT_CALS.includes(name.toLowerCase()) : c.accessRole === 'owner' || !!c.primary,
      partner: PARTNER_NAMES.includes(name) };
  });
  const shown = calendars.filter((c) => calPref(c, gs).show);
  const lists = await g.taskLists(interactive);
  // 새 할일을 넣을 목록 (설정에서 고른 것, 없으면 첫 목록)
  const listId = lists.some((l) => l.id === gs.taskList) ? gs.taskList : lists[0]?.id || '';
  // 할일은 모든 목록에서 받아요 (설정에서 숨긴 목록만 빼고)
  const hidden = new Set(gs.hideLists || []);
  const shownLists = lists.filter((l) => !hidden.has(l.id));
  const [evs, perList] = await Promise.all([
    Promise.all(shown.map((c) => g.events(c.id, from.toISOString(), to.toISOString(), interactive)
      .then((items) => items.filter((e) => e.status !== 'cancelled').map((e) => normEvent(e, { id: c.id, summary: c.name, backgroundColor: c.color, partner: calPref(c, gs).partner }))))),
    Promise.all(shownLists.map((l) => g.tasks(l.id, interactive).then((items) => items.map((x) => normTask(x, l.id))))),
  ]);
  const old = dayKey(addDays(t, -30));
  const tasks = perList.flat().filter((x) => !x.deleted && x.title !== '(제목 없음)').filter((x) => !x.done || !x.completedAt || x.completedAt >= old);
  return {
    calendars, listId,
    lists: lists.map((l, i) => ({ id: l.id, title: l.title || '', show: !hidden.has(l.id), count: tasks.filter((x) => x.listId === l.id && !x.done).length,
      received: shownLists.includes(l) ? perList[shownLists.indexOf(l)].length : null, done: tasks.filter((x) => x.listId === l.id && x.done).length })),
    events: evs.flat(),
    tasks,
    from: dayKey(from), until: dayKey(addDays(to, -1)),
    syncedAt: Date.now(),
  };
}

/** 구글에서 새로 받을 때, 네이버처럼 GitHub에서만 받아 오는 캘린더는 이전 것을 그대로 남겨요 */
export function keepExternal(next, prev) {
  if (!prev) return next;
  const ext = (prev.calendars || []).filter((c) => c.ext);
  if (!ext.length) return next;
  const ids = new Set(ext.map((c) => c.id));
  return { ...next, calendars: [...next.calendars, ...ext], events: [...next.events, ...(prev.events || []).filter((e) => ids.has(e.calId))], naver: prev.naver };
}
