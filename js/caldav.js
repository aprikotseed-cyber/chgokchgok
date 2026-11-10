// 네이버 캘린더(CalDAV) 읽기: GitHub 자동 동기화에서 반려자 캘린더를 받아 와요. 읽기만 해요.
// CalDAV는 일정을 주고받는 표준 방식이에요. 네이버 아이디 + 애플리케이션 비밀번호로 접속해요.
// 날짜·시간은 모두 한국 시간 기준으로 계산해요.
import { normEvent } from './agenda.js?v=20261111j';

const pad = (n) => String(n).padStart(2, '0');

// ───── XML (서버 응답) ─────
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
const tag = (name) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`);

/** multistatus 응답 → [{href, xml}] (응답 하나씩) */
export function responses(xml) {
  return [...String(xml).matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)]
    .map((m) => ({ href: decode((m[1].match(tag('href')) || [])[1] || '').trim(), xml: m[1] }));
}
/** 응답 안에서 이 속성의 값 (안쪽 href가 있으면 그 주소) */
export function prop(xml, name) {
  const m = xml.match(tag(name));
  if (!m) return null;
  const inner = m[1] || '';
  const href = inner.match(tag('href'));
  return decode(href ? href[1] : inner).trim();
}
const isCalendar = (xml) => /<(?:[\w-]+:)?calendar\b/.test((xml.match(tag('resourcetype')) || [])[1] || '');
const hasEvents = (xml) => {
  const set = (xml.match(tag('supported-calendar-component-set')) || [])[1];
  return !set || /VEVENT/i.test(set);
};

// ───── iCalendar (일정 내용) ─────
const unescape = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** 'DTSTART;TZID=Asia/Seoul:20261113T190000' 같은 줄들 → [{name, params, value}] */
function lines(text) {
  return String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const head = l.slice(0, i);
    const [name, ...ps] = head.split(';');
    const params = Object.fromEntries(ps.map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), (v || '').replace(/"/g, '')]));
    return { name: name.toUpperCase(), params, value: l.slice(i + 1) };
  });
}

/**
 * '20261113' / '20261113T190000' / '20261113T100000Z' → 한국 시간 벽시계 {t: UTC 기준 숫자(벽시계 그대로), allDay}
 * TZID가 있으면 한국 시간으로 봐요 (네이버 캘린더는 한국 시간)
 */
export function parseStamp(value, params = {}) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (z) t += 9 * 3600_000; // UTC → 한국 시간
  return { t, allDay: params.VALUE === 'DATE' || !m[4] };
}
const keyOf = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const isoOf = (t) => { const d = new Date(t); return `${keyOf(t)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00+09:00`; };

/** 'PT1H30M', 'P1D', 'P1W' → 밀리초 */
function duration(s) {
  const m = String(s).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w = 0, d = 0, h = 0, mi = 0, sec = 0] = m;
  return (sign === '-' ? -1 : 1) * ((((+w * 7 + +d) * 24 + +h) * 60 + +mi) * 60 + +sec) * 1000;
}

/** ICS 글 → VEVENT 목록 */
export function parseICS(text) {
  const out = [];
  let cur = null;
  let depth = 0; // VALARM 같은 안쪽 블록은 건너뛰기
  for (const l of lines(text)) {
    if (l.name === 'BEGIN' && l.value === 'VEVENT') { cur = { exdates: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (l.name === 'BEGIN') { depth++; continue; }
    if (l.name === 'END' && depth) { depth--; continue; }
    if (l.name === 'END' && l.value === 'VEVENT') { out.push(cur); cur = null; continue; }
    if (depth) continue;
    if (l.name === 'UID') cur.uid = l.value;
    else if (l.name === 'SUMMARY') cur.summary = unescape(l.value);
    else if (l.name === 'LOCATION') cur.location = unescape(l.value);
    else if (l.name === 'STATUS') cur.status = l.value.toUpperCase();
    else if (l.name === 'DTSTART') cur.start = parseStamp(l.value, l.params);
    else if (l.name === 'DTEND') cur.end = parseStamp(l.value, l.params);
    else if (l.name === 'DURATION') cur.duration = duration(l.value);
    else if (l.name === 'RRULE') cur.rrule = Object.fromEntries(l.value.split(';').map((p) => p.split('=')));
    else if (l.name === 'EXDATE') cur.exdates.push(...l.value.split(',').map((v) => parseStamp(v, l.params)?.t).filter((x) => x != null));
    else if (l.name === 'RECURRENCE-ID') cur.recurrenceId = parseStamp(l.value, l.params)?.t;
  }
  return out;
}

const DAY = 86400_000;
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 반복 일정의 시작 시각들 (from~to 사이, 넉넉히 1000개까지) */
export function occurrences(ev, fromT, toT) {
  const start = ev.start.t;
  const r = ev.rrule;
  if (!r) return [start];
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseStamp(r.UNTIL)?.t ?? Infinity : Infinity;
  const s = new Date(start);
  const hms = start - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const byday = (r.BYDAY || '').split(',').filter(Boolean).map((x) => { const m = x.match(/^([+-]?\d+)?(\w\w)$/); return { n: m?.[1] ? Number(m[1]) : 0, wd: WD.indexOf(m?.[2]) }; });
  const bymd = (r.BYMONTHDAY || '').split(',').filter(Boolean).map(Number);
  const out = [];
  let n = 0;
  const push = (t) => { if (t < start || n >= count || t > until) return false; n++; if (t <= toT) out.push(t); return true; };
  // 그 달의 '둘째 월요일'·'마지막 금요일' 같은 날
  const nthWeekday = (y, m, { n: k, wd }) => {
    const days = [];
    for (let d = 1; d <= 31; d++) { const t = Date.UTC(y, m, d); if (new Date(t).getUTCMonth() !== m) break; if (new Date(t).getUTCDay() === wd) days.push(t); }
    return k > 0 ? days[k - 1] : k < 0 ? days[days.length + k] : null;
  };
  for (let i = 0; i < 1000 && n < count; i++) {
    let cands = [];
    if (r.FREQ === 'DAILY') cands = [start + i * interval * DAY];
    else if (r.FREQ === 'WEEKLY') {
      const weekStart = start - ((s.getUTCDay() + 6) % 7) * DAY + i * interval * 7 * DAY; // 그 주 월요일
      const days = byday.length ? byday.map((b) => (b.wd + 6) % 7) : [(s.getUTCDay() + 6) % 7];
      cands = days.sort((a, b) => a - b).map((k) => weekStart + k * DAY);
    } else if (r.FREQ === 'MONTHLY') {
      const y = s.getUTCFullYear() + Math.floor((s.getUTCMonth() + i * interval) / 12);
      const m = (s.getUTCMonth() + i * interval) % 12;
      if (byday.length) cands = byday.map((b) => nthWeekday(y, m, b)).filter((x) => x != null).map((t) => t + hms);
      else cands = (bymd.length ? bymd : [s.getUTCDate()]).map((d) => Date.UTC(y, m, d) + hms).filter((t) => new Date(t).getUTCMonth() === m);
    } else if (r.FREQ === 'YEARLY') {
      const t = Date.UTC(s.getUTCFullYear() + i * interval, s.getUTCMonth(), s.getUTCDate()) + hms;
      cands = new Date(t).getUTCMonth() === s.getUTCMonth() ? [t] : []; // 2월 29일은 윤년에만
    } else return [start];
    let stop = false;
    for (const t of cands.sort((a, b) => a - b)) {
      if (t > until || t > toT) { stop = true; break; }
      push(t);
    }
    if (stop) break;
  }
  return out.filter((t) => !ev.exdates.includes(t));
}

/**
 * ICS 글들 → 앱 일정 (from·to: 'YYYY-MM-DD').
 * cal: {id, name, color, partner}
 */
export function icsToEvents(texts, cal, from, to) {
  const fromT = Date.parse(`${from}T00:00:00Z`);
  const toT = Date.parse(`${to}T23:59:59Z`);
  const all = texts.flatMap(parseICS).filter((e) => e.start && e.status !== 'CANCELLED');
  // 반복 일정 중 따로 고친 날 (RECURRENCE-ID)
  const moved = new Set(all.filter((e) => e.recurrenceId != null).map((e) => `${e.uid}@${e.recurrenceId}`));
  const out = [];
  for (const e of all) {
    const len = e.end ? e.end.t - e.start.t : e.duration || (e.start.allDay ? DAY : 0);
    const starts = e.recurrenceId != null ? [e.start.t] : occurrences(e, fromT, toT).filter((t) => !moved.has(`${e.uid}@${t}`));
    for (const t of starts) {
      const end = t + Math.max(len, 0);
      if (end < fromT || t > toT) continue;
      const g = e.start.allDay
        ? { start: { date: keyOf(t) }, end: { date: keyOf(Math.max(end, t + DAY)) } }
        : { start: { dateTime: isoOf(t) }, end: { dateTime: isoOf(end) } };
      out.push(normEvent({ id: `${e.uid || 'ev'}_${t}`, summary: e.summary, location: e.location, ...g }, { id: cal.id, summary: cal.name, backgroundColor: cal.color, partner: cal.partner }));
    }
  }
  return out;
}

// ───── 서버와 주고받기 ─────
const XML = { 'Content-Type': 'application/xml; charset=utf-8' };

/**
 * 네이버(또는 다른 CalDAV) 캘린더 받기 → {calendars: [{id, name, color}], events}
 * from·to: 'YYYY-MM-DD', gs: settings.google (캘린더별 보기·반려자 설정)
 */
export async function fetchCalDav({ base, user, pass, from, to, gs = {}, fetchImpl = fetch, idPrefix = 'naver:', label = '네이버' }) {
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const call = async (url, method, depth, body, raw = false) => {
    const res = await fetchImpl(url, { method, headers: { ...XML, Authorization: auth, ...(depth != null ? { Depth: String(depth) } : {}) }, body });
    if (res.status === 401 || res.status === 403) throw new Error(`${label} 로그인 실패: 아이디나 애플리케이션 비밀번호를 확인해 주세요`);
    if (!res.ok && res.status !== 207) throw Object.assign(new Error(`${label} 캘린더 오류 ${res.status}`), { status: res.status });
    return raw ? res : res.text();
  };
  const abs = (href, at) => new URL(href, at).href;
  const principalXml = await call(base, 'PROPFIND', 0, '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>');
  const principal = abs(prop(principalXml, 'current-user-principal') || base, base);
  const homeXml = await call(principal, 'PROPFIND', 0, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>');
  const home = abs(prop(homeXml, 'calendar-home-set') || principal, principal);
  const listXml = await call(home, 'PROPFIND', 1, '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><ic:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>');
  const cals = responses(listXml).filter((r) => isCalendar(r.xml) && hasEvents(r.xml)).map((r) => ({
    url: abs(r.href, home), id: `${idPrefix}${r.href}`,
    name: `${prop(r.xml, 'displayname') || '캘린더'} (${label})`,
    color: (prop(r.xml, 'calendar-color') || '#8b8a83').slice(0, 7),
  }));
  const range = (k, end) => `${k.replaceAll('-', '')}T${end ? '235959' : '000000'}Z`;
  const query = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${range(from)}" end="${range(to, true)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const calendars = [];
  const events = [];
  const debug = [];
  for (const c of cals) {
    const pref = gs.cals?.[c.id] || {};
    const cal = { id: c.id, name: c.name, color: c.color, primary: false, write: false, ext: 'naver', show: true, partner: true };
    calendars.push(cal);
    if (pref.show === false) continue;
    const { texts, dbg } = await calendarTexts(c.url, query, call, abs);
    const evs = icsToEvents(texts, { ...cal, partner: pref.partner ?? true }, from, to);
    debug.push({ name: c.name, ...dbg, events: evs.length });
    events.push(...evs);
  }
  return { calendars, events, debug };
}

/**
 * 한 캘린더의 일정 글(ICS)들. 서버마다 방식이 달라서 차례로 시도해요:
 * ① 기간 검색(REPORT) → ② 검색 결과 주소로 한꺼번에(multiget) → ③ 전체 목록에서 한꺼번에 → ④ 하나씩 GET
 * dbg에는 개수와 상태만 (내용은 남기지 않아요). sample은 앱 설정의 진단용으로만 저장해요.
 */
async function calendarTexts(url, query, call, abs) {
  const dbg = {};
  const data = (xml) => responses(xml).map((r) => prop(r.xml, 'calendar-data')).filter((x) => x && /BEGIN:VCALENDAR/.test(x));
  const self = new URL(url).pathname;
  let hrefs = [];
  let texts = [];
  try {
    const xml = await call(url, 'REPORT', 1, query);
    const rs = responses(xml);
    dbg.report = rs.length;
    texts = data(xml);
    dbg.reportData = texts.length;
    hrefs = rs.map((r) => r.href).filter((h) => h && h !== self);
    if (!rs.length) dbg.sample = xml.replace(/\s+/g, ' ').slice(0, 300);
  } catch (e) { dbg.reportError = e.status || e.message; }
  if (!texts.length && !hrefs.length) {
    try {
      const xml = await call(url, 'PROPFIND', 1, '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontenttype/></d:prop></d:propfind>');
      hrefs = responses(xml).map((r) => r.href).filter((h) => h && h !== self && abs(h, url) !== url);
      dbg.listed = hrefs.length;
    } catch (e) { dbg.listError = e.status || e.message; }
  }
  if (!texts.length && hrefs.length) {
    try {
      for (let i = 0; i < hrefs.length; i += 50) {
        const body = `<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs.slice(i, i + 50).map((h) => `<d:href>${h.replace(/&/g, '&amp;')}</d:href>`).join('')}</c:calendar-multiget>`;
        texts.push(...data(await call(url, 'REPORT', 1, body)));
      }
      dbg.multiget = texts.length;
    } catch (e) { dbg.multigetError = e.status || e.message; }
  }
  if (!texts.length && hrefs.length) {
    let ok = 0;
    for (const h of hrefs.slice(0, 300)) {
      try {
        const res = await call(abs(h, url), 'GET', null, undefined, true);
        const t = await res.text();
        if (/BEGIN:VCALENDAR/.test(t)) { texts.push(t); ok++; }
      } catch { /* 하나 실패해도 계속 */ }
    }
    dbg.get = ok;
  }
  return { texts, dbg };
}
