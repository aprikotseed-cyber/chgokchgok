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
// 할일은 구글 태스크에 실제로 있는 것만 보여줘요 (메모에 적힌 '시간 15:00'을 시간으로 따로 해석하지 않아요)
export function normTask(t, listId = '') {
  return {
    id: t.id, listId, title: t.title || '(제목 없음)',
    notes: t.notes || '',
    time: '',
    due: t.due ? t.due.slice(0, 10) : '', done: t.status === 'completed', deleted: !!t.deleted,
    // 완료 시각은 UTC라서, 한국 아침(0~9시)에 끝낸 것도 그날로 보이게 이 기기 날짜로 바꿔요
    completedAt: t.completed ? (isNaN(new Date(t.completed)) ? t.completed.slice(0, 10) : dayKey(new Date(t.completed))) : '', updated: t.updated || '',
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
  const byDue = (a, b) => a.due.localeCompare(b.due) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title);
  for (const k of ['overdue', 'today', 'tomorrow', 'week', 'later']) g[k].sort(byDue);
  g.done.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return g;
}

/**
 * 홈 '오늘' 할일: 오늘까지 해야 할 일 + 그중 끝낸 일(체크된 채로 남겨 둬요). 끝내도 자리가 바뀌지 않게 마감 순서대로.
 * 마감이 앞으로인 할일을 미리 끝냈으면 오늘 목록엔 넣지 않아요 (그 마감일에만 보여요).
 */
export function todayTasks(tasks, todayKey) {
  const keep = (t) => !!t.due && (t.done ? t.due === todayKey || (t.due < todayKey && t.completedAt === todayKey) : t.due <= todayKey);
  return (tasks || []).filter(keep).sort((a, b) => (a.due || todayKey).localeCompare(b.due || todayKey) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
}

/** 구글 태스크에 보낼 due 값 */
export const toTaskDue = (key) => (key ? `${key}T00:00:00.000Z` : undefined);

// ───── 빠른 입력: '내일 우유 사기', '금요일 보고서', '11/20 병원' ─────

/**
 * 할일 한 줄에서 날짜를 뽑고 나머지를 제목으로.
 * 요일만 말하면 이번 주(월~일)의 그 요일, '다음 주 ○요일'이면 다음 주. 날짜가 없으면 due 없음.
 */
export function parseQuickTask(text, now = new Date()) {
  const rep = parseRepeat(text, now);
  // 쉼표·괄호는 띄어쓰기로 ('다음 주 화요일, 보고서', '17일(화)')
  let s = ` ${rep.rest} `.replace(/[,，、()（）]/g, ' ');
  // 반복 할일을 몇 번 만들지: '12주치', '8회', '10번', '6개월치' (반복 말이 있을 때만)
  let count = null;
  if (rep.rule) {
    const cm = s.match(/\s(\d{1,3})\s?(주치|주\s?동안|회|번|개월치|개월\s?동안|달치)(만큼|씩)?\s/);
    if (cm) { count = { n: Number(cm[1]), unit: /주/.test(cm[2]) ? 'week' : /개월|달/.test(cm[2]) ? 'month' : 'times' }; s = s.replace(cm[0], ' '); }
  }
  // '오후 3시', '15:30' 같은 시간은 제목에서 빼서 따로
  let time = '';
  const tm = s.match(TIME_RE);
  if (tm) { const a = toHM(tm[1], tm[2], tm[3], tm[4], tm[5]); if (a != null) { time = hm(a); s = s.replace(tm[0], ' '); } }
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
  // 날짜를 콕 집은 말이 요일보다 먼저: '17일 화요일', '11월 17일 화요일까지'
  const WD = '(?:\\s?[월화수목금토일](?:요일)?)?';
  const UNTIL = '(까지|에|날)?';
  take(new RegExp(`\\s(\\d{1,2})월\\s?(\\d{1,2})일${WD}${UNTIL}\\s`), (m) => nearest(today, Number(m[1]), Number(m[2])));
  take(new RegExp(`\\s(\\d{1,2})[/.](\\d{1,2})${WD}${UNTIL}\\s`), (m) => nearest(today, Number(m[1]), Number(m[2])));
  // '3일 뒤', '10일 후'
  take(/\s(\d{1,3})일\s?(뒤|후)(에|까지)?\s/, (m) => addDays(today, Number(m[1])));
  // '26일'만 쓰면 이번 달 26일, 이미 지났으면 다음 달
  take(new RegExp(`\\s(\\d{1,2})일${WD}${UNTIL}\\s`), (m) => {
    const d = Number(m[1]);
    if (d < 1 || d > 31) return null;
    const x = new Date(today.getFullYear(), today.getMonth(), d);
    return x < today ? new Date(today.getFullYear(), today.getMonth() + 1, d) : x;
  });
  take(/\s(다음\s?주|담주)\s?([월화수목금토일])(요일)?(까지|에)?\s/, (m) => addDays(monday, 7 + dayIdx(m[2])));
  take(/\s(이번\s?주\s?)?([월화수목금토일])요일(까지|에)?\s/, (m) => addDays(monday, dayIdx(m[2])));
  // 제목을 따옴표로 감싸 말해도 따옴표는 빼요: '귀 세척' → 귀 세척
  const title = s.replace(/\s+/g, ' ').trim().replace(/^['"‘’“”](.+)['"‘’“”]$/, '$1').trim();
  const t = time ? { time } : {};
  if (!rep.rule) return { title, due, ...t };
  // 반복: 날짜를 따로 안 쓰면 오늘부터 첫 차례
  const first = due && matchesRule(rep.rule, due) ? due : firstOccurrence(rep.rule, due || dayKey(today));
  return { title, due: first, ...t, repeat: { ...rep.rule, anchor: first }, ...(count ? { count } : {}) };
}

/**
 * 반복 할일을 구글 태스크에 '따로따로' 미리 만들 날짜들 (구글 태스크는 앱에서 반복을 넣을 수 없어서).
 * count: {n, unit: 'week'|'month'|'times'}. 없으면 매주는 8주치, 매월은 6개월치, 매일은 14번, 매년은 3번.
 * 너무 많이 만들지 않게 60개까지만.
 */
export function occurrences(rule, startKey, count) {
  const c = count || (rule.freq === 'weekly' ? { n: 8, unit: 'week' } : rule.freq === 'monthly' ? { n: 6, unit: 'month' } : rule.freq === 'daily' ? { n: 14, unit: 'times' } : { n: 3, unit: 'times' });
  const start = fromKey(startKey);
  const end = c.unit === 'week' ? dayKey(addDays(start, 7 * c.n - 1))
    : c.unit === 'month' ? dayKey(addDays(new Date(start.getFullYear(), start.getMonth() + c.n, start.getDate()), -1)) : '';
  const out = [];
  let k = matchesRule({ ...rule, anchor: rule.anchor || startKey }, startKey) ? startKey : firstOccurrence(rule, startKey);
  while (k && out.length < 60 && (end ? k <= end : out.length < c.n)) {
    out.push(k);
    k = nextOccurrence({ ...rule, anchor: rule.anchor || startKey }, k);
  }
  return out;
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
const TIME_RE = new RegExp(`\\s${T}(?:\\s?(?:~|-|부터)\\s?${T}(?:까지)?)?(?:에|부터|으로|로|까지)?\\s`);

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
  const { title, due, repeat } = parseQuickTask(s, now);
  return { title, date: due, time, endTime, allDay: !time, ...(repeat ? { repeat } : {}) };
}

/** 캘린더 고르기 (덕준님 기준): 생일 → Birthday, 대학원 → Life, 운동 → Exercise, 공연·영화·전시 → Cherish, 학교·업무·연수 → Work, 나머지 → Life */
const CAL_RULES = [
  ['Birthday', /생일|생신|탄신/],
  ['Life', /대학원|논문|지도교수/],
  ['Exercise', /운동|헬스|러닝|달리기|조깅|요가|필라테스|수영|등산|pt|자전거|클라이밍|테니스|골프|배드민턴|스트레칭|마라톤|축구|농구|볼링/i],
  ['Cherish', /공연|영화|전시|콘서트|뮤지컬|연극|미술관|박물관|페스티벌|팬미팅|오페라|발레/],
  ['Work', /학교|업무|회의|협의|연수|출장|상담|학부모|교무|공문|교육청|수업|평가|채점|현장체험|졸업식|입학식|방학식|개학|학년|담임|교직원|직원|워크숍|세미나|당직|부장|교장|교감|회식/],
];
export function classifyEvent(title) {
  for (const [cal, re] of CAL_RULES) if (re.test(title)) return cal;
  return 'Life';
}

/** 앱 일정 → 구글 캘린더 일정 (한국 시간) */
export function toGoogleEvent({ title, date, endDate, allDay, time, endTime, location, notes, repeat }) {
  const body = { summary: title };
  if (repeat) body.recurrence = [toRRule(repeat)];
  if (location !== undefined) body.location = location;
  if (notes !== undefined) body.description = notes;
  if (allDay || !time) {
    const last = endDate && endDate > date ? endDate : date;
    // 고칠 때(PATCH)는 구글이 기존 값에 덧붙여서, 반대쪽 값(dateTime)을 null로 지워야 해요
    body.start = { date, dateTime: null, timeZone: null };
    body.end = { date: dayKey(addDays(fromKey(last), 1)), dateTime: null, timeZone: null }; // 구글은 끝 날짜를 '다음 날'로 받아요
  } else {
    let end = endTime && endTime > time ? endTime : hm(Math.min(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + 60, 23 * 60 + 59));
    // 종일 → 시간 지정으로 바꿀 때 기존 date가 남으면 'Invalid start time'이라서 null로 지워요
    body.start = { date: null, dateTime: `${date}T${time}:00`, timeZone: 'Asia/Seoul' };
    body.end = { date: null, dateTime: `${date}T${end}:00`, timeZone: 'Asia/Seoul' };
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
  // 할일은 차곡차곡에 직접 저장해요 (구글 태스크는 받아오지 않아요). 일정만 구글 캘린더에서 받아요
  const evs = await Promise.all(shown.map((c) => g.events(c.id, from.toISOString(), to.toISOString(), interactive)
    .then((items) => items.filter((e) => e.status !== 'cancelled').map((e) => normEvent(e, { id: c.id, summary: c.name, backgroundColor: c.color, partner: calPref(c, gs).partner })))));
  return {
    calendars,
    events: evs.flat(),
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

// ───── 반복: '매주 토요일', '매일', '평일마다', '격주 수요일', '매월 25일', '매년' ─────
// 규칙 {freq: 'daily'|'weekly'|'monthly'|'yearly', interval, byday: [0~6 (일~토)], day: 매월 며칠, anchor: 첫 날, until}
const DAYS = '일월화수목금토';
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// '요일'의 '일'을 일요일로 세지 않게 먼저 지워요
const daysIn = (str) => [...new Set([...String(str).replace(/요일/g, '')].map((c) => DAYS.indexOf(c)).filter((i) => i >= 0))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
// '월', '월요일', '월, 목요일', '월요일·목요일', '월/목', '월과 목'처럼 요일 여러 개
const DAY_LIST = '[월화수목금토일](?:요일)?(?:\\s*(?:,|·|/|와|과|랑|및|하고)?\\s*[월화수목금토일](?:요일)?)*';

/** 글에서 반복 말을 찾아 {rule, rest} (rest는 반복 말을 뺀 글) */
export function parseRepeat(text) {
  let s = ` ${String(text || '').trim()} `;
  let rule = null;
  const take = (re, fn) => {
    if (rule) return;
    const m = s.match(re);
    if (!m) return;
    rule = fn(m);
    s = s.replace(m[0], ' ');
  };
  take(/\s(매일|날마다)\s/, () => ({ freq: 'daily', interval: 1 }));
  take(/\s(평일마다|매\s?평일|평일\s?매일)\s/, () => ({ freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] }));
  take(/\s(주말마다|매\s?주말)\s/, () => ({ freq: 'weekly', interval: 1, byday: [6, 0] }));
  // 쉼표 붙은 요일 목록도 한 덩어리로 보려고, 반복 말을 찾을 때만 쉼표 뒤를 띄어 둬요
  s = s.replace(/([월화수목금토일](?:요일)?)\s*([,·/])\s*(?=[월화수목금토일])/g, '$1$2');
  take(new RegExp(`\\s(격주|2주마다|이주마다)\\s?(${DAY_LIST})?(마다|에)?[,]?\\s`), (m) => ({ freq: 'weekly', interval: 2, byday: daysIn(m[2] || '') }));
  take(new RegExp(`\\s(매주|주마다)\\s?(${DAY_LIST})?(마다|에)?[,]?\\s`), (m) => ({ freq: 'weekly', interval: 1, byday: daysIn(m[2] || '') }));
  take(new RegExp(`\\s(${DAY_LIST})\\s?마다\\s`), (m) => ({ freq: 'weekly', interval: 1, byday: daysIn(m[1]) }));
  take(/\s(매월|매달|다달이)\s?(\d{1,2})일(마다|에)?\s/, (m) => ({ freq: 'monthly', interval: 1, day: Number(m[2]) }));
  take(/\s(매월|매달|다달이)\s/, () => ({ freq: 'monthly', interval: 1 }));
  take(/\s(매년|해마다)\s/, () => ({ freq: 'yearly', interval: 1 }));
  return { rule, rest: s.replace(/\s+/g, ' ').trim() };
}

const monthDay = (y, m, d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

/** 이 날이 규칙에 맞는 날인지 */
export function matchesRule(rule, key) {
  const d = fromKey(key);
  if (rule.until && key > rule.until) return false;
  if (rule.freq === 'daily') return !rule.anchor || Math.round((d - fromKey(rule.anchor)) / 86400000) % (rule.interval || 1) === 0;
  if (rule.freq === 'weekly') {
    const days = rule.byday?.length ? rule.byday : [fromKey(rule.anchor || key).getDay()];
    if (!days.includes(d.getDay())) return false;
    if ((rule.interval || 1) > 1 && rule.anchor) return Math.round((mondayOf(d) - mondayOf(fromKey(rule.anchor))) / (7 * 86400000)) % rule.interval === 0;
    return true;
  }
  if (rule.freq === 'monthly') { const want = rule.day || fromKey(rule.anchor || key).getDate(); return dayKey(monthDay(d.getFullYear(), d.getMonth(), want)) === key; }
  if (rule.freq === 'yearly') { const a = fromKey(rule.anchor || key); return dayKey(monthDay(d.getFullYear(), a.getMonth(), a.getDate())) === key; }
  return false;
}

/** key 날짜부터(그날 포함) 첫 차례 */
export function firstOccurrence(rule, key) {
  for (let i = 0; i < 400; i++) { const k = dayKey(addDays(fromKey(key), i)); if (matchesRule({ ...rule, anchor: rule.anchor || key }, k)) return k; }
  return key;
}

/** key 다음 차례 (끝났으면 '') */
export function nextOccurrence(rule, key) {
  const r = { ...rule, anchor: rule.anchor || key };
  let n = '';
  if (r.freq === 'monthly') { const d = fromKey(key); n = dayKey(monthDay(d.getFullYear(), d.getMonth() + (r.interval || 1), r.day || fromKey(r.anchor).getDate())); }
  else if (r.freq === 'yearly') { const d = fromKey(key); const a = fromKey(r.anchor); n = dayKey(monthDay(d.getFullYear() + (r.interval || 1), a.getMonth(), a.getDate())); }
  else if (r.freq === 'daily') n = dayKey(addDays(fromKey(key), r.interval || 1));
  else for (let i = 1; i <= 7 * (r.interval || 1) + 7; i++) { const k = dayKey(addDays(fromKey(key), i)); if (matchesRule(r, k)) { n = k; break; } }
  return n && (!r.until || n <= r.until) ? n : '';
}

/** 다음 차례 중 오늘(todayKey) 이후로 가장 가까운 날 (늦게 끝내도 지난 날짜로 만들지 않아요) */
export function nextFrom(rule, key, todayKey) {
  let n = nextOccurrence(rule, key);
  for (let i = 0; n && n < todayKey && i < 1000; i++) n = nextOccurrence(rule, n);
  return n;
}

/** 구글 캘린더 반복 규칙 */
export function toRRule(rule) {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if ((rule.interval || 1) > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byday?.length) parts.push(`BYDAY=${rule.byday.map((i) => BYDAY[i]).join(',')}`);
  if (rule.freq === 'monthly' && rule.day) parts.push(`BYMONTHDAY=${rule.day}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}`);
  return `RRULE:${parts.join(';')}`;
}

/** '매주 토요일', '평일마다', '2주마다 수요일', '매월 25일', '매년' */
export function repeatLabel(rule, dateKey = '') {
  if (!rule) return '';
  const d = dateKey ? fromKey(dateKey) : null;
  if (rule.freq === 'daily') return rule.interval > 1 ? `${rule.interval}일마다` : '매일';
  if (rule.freq === 'weekly') {
    const days = rule.byday?.length ? rule.byday : d ? [d.getDay()] : [];
    const key = days.join();
    if (rule.interval === 1 && key === '1,2,3,4,5') return '평일마다';
    if (rule.interval === 1 && (key === '6,0' || key === '0,6')) return '주말마다';
    return `${rule.interval > 1 ? `${rule.interval}주마다` : '매주'} ${days.map((i) => DAYS[i]).join('·')}요일`;
  }
  if (rule.freq === 'monthly') return `매월 ${rule.day || d?.getDate() || ''}일`;
  if (rule.freq === 'yearly') return d ? `매년 ${d.getMonth() + 1}월 ${d.getDate()}일` : '매년';
  return '';
}

/** 입력창 '반복' 고르기 ↔ 규칙 */
export const REPEAT_CHOICES = [['', '반복 안 함'], ['daily', '매일'], ['weekdays', '평일마다'], ['weekly', '매주 (같은 요일)'], ['biweekly', '2주마다 (같은 요일)'], ['monthly', '매월 (같은 날짜)'], ['yearly', '매년']];
export function ruleFromChoice(choice, dateKey, old) {
  const wd = dateKey ? fromKey(dateKey).getDay() : new Date().getDay();
  const anchor = dateKey || undefined;
  if (choice === 'daily') return { freq: 'daily', interval: 1, anchor };
  if (choice === 'weekdays') return { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5], anchor };
  if (choice === 'weekly') return { freq: 'weekly', interval: 1, byday: [wd], anchor };
  if (choice === 'biweekly') return { freq: 'weekly', interval: 2, byday: [wd], anchor };
  if (choice === 'monthly') return { freq: 'monthly', interval: 1, day: dateKey ? fromKey(dateKey).getDate() : undefined, anchor };
  if (choice === 'yearly') return { freq: 'yearly', interval: 1, anchor };
  if (choice === 'keep') return old || null;
  return null;
}
export function choiceOf(rule) {
  if (!rule) return '';
  const days = (rule.byday || []).join();
  if (rule.freq === 'daily' && (rule.interval || 1) === 1) return 'daily';
  if (rule.freq === 'weekly' && (rule.interval || 1) === 1 && days === '1,2,3,4,5') return 'weekdays';
  if (rule.freq === 'weekly' && (rule.byday || []).length <= 1) return (rule.interval || 1) === 2 ? 'biweekly' : (rule.interval || 1) === 1 ? 'weekly' : 'keep';
  if (rule.freq === 'monthly' && (rule.interval || 1) === 1) return 'monthly';
  if (rule.freq === 'yearly') return 'yearly';
  return 'keep';
}

// ───── 캘린더 고르기: ① 말한 캘린더 이름 → ② 나만의 낱말 → ③ 기본 규칙 ─────
const CAL_SAY = { work: ['work', '워크', '업무'], life: ['life', '라이프'], exercise: ['exercise', '엑서사이즈', '운동'], cherish: ['cherish', '체리시'], birthday: ['birthday', '버스데이', '생일'] };

/**
 * '라이프에 금요일 7시 라스런회의', 'Work 캘린더에 내일 상담' → {text: 캘린더 말을 뺀 글, calName}
 * calendars: [{name}] (내 캘린더들), keywords: [{word, cal}] (설정의 나만의 낱말)
 */
export function pickCalendar(text, calendars = [], keywords = []) {
  const names = calendars.map((c) => c.name);
  const find = (w) => {
    const k = w.toLowerCase();
    return names.find((n) => n.toLowerCase() === k)
      || names.find((n) => (CAL_SAY[n.toLowerCase()] || []).includes(k));
  };
  let s = String(text || '').trim();
  let calName = '';
  // 맨 앞: '라이프에 …', 'Work 캘린더에 …', '운동 캘린더로 …'
  const m = s.match(/^(\S+?)\s*(?:캘린더)?\s*(?:에|로|으로)\s+/);
  if (m && find(m[1]) && (m[0].includes('캘린더') || /에|로/.test(m[0]))) { calName = find(m[1]); s = s.slice(m[0].length); }
  // 맨 뒤: '… 라이프 캘린더에'
  if (!calName) {
    const e = s.match(/\s+(\S+?)\s*캘린더(?:에|로|으로)?\s*$/);
    if (e && find(e[1])) { calName = find(e[1]); s = s.slice(0, e.index); }
  }
  if (!calName) {
    const hit = (keywords || []).find((k) => k.word && s.includes(k.word) && names.includes(k.cal));
    if (hit) calName = hit.cal;
  }
  return { text: s, calName };
}

/** 일정 한 줄 → 일정 + 캘린더 이름 (말한 캘린더 / 나만의 낱말 / 기본 규칙 순) */
export function parseEventInput(text, now, calendars = [], keywords = []) {
  const { text: rest, calName } = pickCalendar(text, calendars, keywords);
  const p = parseQuickEvent(rest, now);
  const want = calName || (keywords || []).find((k) => k.word && p.title.includes(k.word))?.cal || classifyEvent(p.title);
  const cal = calendars.find((c) => c.name.toLowerCase() === want.toLowerCase());
  return { ...p, calName: cal?.name || want };
}

/** 단축어가 보낸 종류 → 'event' | 'task' | 'memo'. 글자('일정')나 이모지(🗓️ ☑️ 📝) 모두 알아들어요 */
export function inboxKind(raw) {
  const s = String(raw || '').replace(/️/g, '').trim().toLowerCase();
  const ev = /일정|약속|event|calendar|[📅📆🗓⏰]/u.test(s);
  const tk = /할일|할 일|투두|todo|task|[✅☑✔📋]/u.test(s);
  const mm = /메모|memo|[📝🗒]/u.test(s);
  // 여러 종류가 한꺼번에 오면 단축어가 '선택한 항목' 대신 목록 전체를 보낸 거예요
  if (ev + tk + mm > 1) return 'mixed';
  if (ev) return 'event';
  if (tk) return 'task';
  return 'memo'; // 메모·📝·🗒 또는 알 수 없으면 메모로 (내용을 잃지 않게)
}
