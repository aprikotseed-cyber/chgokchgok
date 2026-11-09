import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, icsToEvents, responses, prop, fetchCalDav } from '../js/caldav.js';

process.env.TZ = 'Asia/Seoul'; // 서버(GitHub)처럼 한국 시간으로

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a1
DTSTART;TZID=Asia/Seoul:20261113T190000
DTEND;TZID=Asia/Seoul:20261113T210000
SUMMARY:저녁 약속\\, 강남
LOCATION:강남역
BEGIN:VALARM
TRIGGER:-PT10M
SUMMARY:알림
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261122
SUMMARY:제주 출장
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART:20261109T003000Z
DURATION:PT1H
SUMMARY:아침 회의
END:VEVENT
BEGIN:VEVENT
UID:w
DTSTART;TZID=Asia/Seoul:20261102T070000
DTEND;TZID=Asia/Seoul:20261102T080000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6
EXDATE;TZID=Asia/Seoul:20261111T070000
SUMMARY:요가
END:VEVENT
BEGIN:VEVENT
UID:w
RECURRENCE-ID;TZID=Asia/Seoul:20261109T070000
DTSTART;TZID=Asia/Seoul:20261109T090000
DTEND;TZID=Asia/Seoul:20261109T100000
SUMMARY:요가 (늦게)
END:VEVENT
BEGIN:VEVENT
UID:m
DTSTART;VALUE=DATE:20261001
RRULE:FREQ=MONTHLY;BYDAY=-1FR
SUMMARY:월말 정산
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART;VALUE=DATE:20261115
SUMMARY:취소된 일정
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

const cal = { id: 'naver:/cal/1/', name: '내 일정 (네이버)', color: '#00c73c', partner: true };

test('iCalendar 읽기: 시간·종일·UTC·알림 블록 무시', () => {
  const evs = parseICS(ICS);
  assert.equal(evs[0].summary, '저녁 약속, 강남');
  assert.equal(evs.length, 7);
});

test('네이버 일정 → 앱 일정: 반복(주간·월말 금요일), 빼는 날, 옮긴 날, 취소', () => {
  const e = icsToEvents([ICS], cal, '2026-11-01', '2026-11-30');
  const by = (t) => e.filter((x) => x.title === t).map((x) => `${x.startKey} ${x.time}`.trim());
  assert.deepEqual(by('저녁 약속, 강남'), ['2026-11-13 19:00']);
  assert.equal(e.find((x) => x.title === '제주 출장').endKey, '2026-11-21');
  assert.deepEqual(by('아침 회의'), ['2026-11-09 09:30']); // UTC 00:30 → 한국 09:30
  // COUNT 6: 11/2 월, 11/4 수, 11/9 월(9시로 옮김), 11/11 수(뺀 날도 횟수에 들어가요), 11/16 월, 11/18 수
  assert.deepEqual(by('요가'), ['2026-11-02 07:00', '2026-11-04 07:00', '2026-11-16 07:00', '2026-11-18 07:00']);
  assert.deepEqual(by('요가 (늦게)'), ['2026-11-09 09:00']);
  assert.deepEqual(by('월말 정산'), ['2026-11-27']);
  assert.equal(by('취소된 일정').length, 0);
  assert.ok(e.every((x) => x.partner && x.calId === cal.id));
});

test('CalDAV: 주소 찾기 → 캘린더 목록 → 일정 받기 (가짜 서버)', async () => {
  const base = 'https://caldav.calendar.naver.com/';
  const seen = [];
  const fake = async (url, opt) => {
    seen.push(`${opt.method} ${new URL(url).pathname} ${opt.headers.Depth}`);
    assert.match(opt.headers.Authorization, /^Basic /);
    const ms = (body) => ({ ok: true, status: 207, text: async () => `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</D:multistatus>` });
    if (opt.method === 'PROPFIND' && url === base) return ms('<D:response><D:href>/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>/principals/users/partner/</D:href></D:current-user-principal></D:prop></D:propstat></D:response>');
    if (url.endsWith('/principals/users/partner/')) return ms('<D:response><D:href>/principals/users/partner/</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>/calendar/partner/</D:href></C:calendar-home-set></D:prop></D:propstat></D:response>');
    if (url.endsWith('/calendar/partner/') && opt.method === 'PROPFIND') return ms(`
      <D:response><D:href>/calendar/partner/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
      <D:response><D:href>/calendar/partner/1/</D:href><D:propstat><D:prop><D:displayname>내 일정</D:displayname><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><x:calendar-color xmlns:x="http://apple.com/ns/ical/">#00C73CFF</x:calendar-color></D:prop></D:propstat></D:response>
      <D:response><D:href>/calendar/partner/todo/</D:href><D:propstat><D:prop><D:displayname>할 일</D:displayname><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></D:prop></D:propstat></D:response>`);
    if (opt.method === 'REPORT') { assert.match(opt.body, /time-range start="20261101T000000Z"/); return ms(`<D:response><D:href>/calendar/partner/1/a.ics</D:href><D:propstat><D:prop><C:calendar-data>${ICS.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</C:calendar-data></D:prop></D:propstat></D:response>`); }
    return { ok: false, status: 404, text: async () => '' };
  };
  const r = await fetchCalDav({ base, user: 'partner', pass: 'app-pw', from: '2026-11-01', to: '2026-11-30', fetchImpl: fake });
  assert.deepEqual(r.calendars.map((c) => [c.id, c.name, c.color, c.partner, c.write]), [['naver:/calendar/partner/1/', '내 일정 (네이버)', '#00C73C', true, false]]);
  assert.ok(r.events.some((e) => e.title === '제주 출장'));
  assert.deepEqual(seen.slice(0, 3), ['PROPFIND / 0', 'PROPFIND /principals/users/partner/ 0', 'PROPFIND /calendar/partner/ 1']);
  // 로그인 실패 안내
  await assert.rejects(fetchCalDav({ base, user: 'x', pass: 'y', from: '2026-11-01', to: '2026-11-30', fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) }), /애플리케이션 비밀번호/);
  assert.equal(prop(responses('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/a</d:href><d:propstat><d:prop><d:displayname>A &amp; B</d:displayname></d:prop></d:propstat></d:response></d:multistatus>')[0].xml, 'displayname'), 'A & B');
});

test('CalDAV: 기간 검색에 내용이 없으면 multiget, 그것도 안 되면 하나씩 받기', async () => {
  const base = 'https://cal.example/';
  const ICS1 = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20261115\nSUMMARY:하나씩 받은 일정\nEND:VEVENT\nEND:VCALENDAR';
  const ms = (body) => ({ ok: true, status: 207, text: async () => `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</D:multistatus>` });
  const make = (mode) => async (url, opt) => {
    const p = new URL(url).pathname;
    if (opt.method === 'PROPFIND' && p === '/') return ms('<D:response><D:href>/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>/u/</D:href></D:current-user-principal></D:prop></D:propstat></D:response>');
    if (opt.method === 'PROPFIND' && p === '/u/' && opt.headers.Depth === '0') return ms('<D:response><D:href>/u/</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>/u/cals/</D:href></C:calendar-home-set></D:prop></D:propstat></D:response>');
    if (opt.method === 'PROPFIND' && p === '/u/cals/') return ms('<D:response><D:href>/u/cals/a/</D:href><D:propstat><D:prop><D:displayname>A</D:displayname><D:resourcetype><D:collection/><C:calendar/></D:resourcetype></D:prop></D:propstat></D:response>');
    if (opt.method === 'REPORT' && /calendar-query/.test(opt.body)) return mode === 'hrefs' ? ms('<D:response><D:href>/u/cals/a/1.ics</D:href><D:propstat><D:prop><D:getetag>"1"</D:getetag></D:prop></D:propstat></D:response>') : ms('');
    if (opt.method === 'REPORT' && /multiget/.test(opt.body)) return mode === 'hrefs' ? ms(`<D:response><D:href>/u/cals/a/1.ics</D:href><D:propstat><D:prop><C:calendar-data><![CDATA[${ICS1}]]></C:calendar-data></D:prop></D:propstat></D:response>`) : ms('');
    if (opt.method === 'PROPFIND' && p === '/u/cals/a/') return ms('<D:response><D:href>/u/cals/a/</D:href></D:response><D:response><D:href>/u/cals/a/1.ics</D:href></D:response>');
    if (opt.method === 'GET' && p === '/u/cals/a/1.ics') return { ok: true, status: 200, text: async () => ICS1 };
    return { ok: false, status: 404, text: async () => '' };
  };
  const a = await fetchCalDav({ base, user: 'u', pass: 'p', from: '2026-11-01', to: '2026-11-30', fetchImpl: make('hrefs') });
  assert.deepEqual([a.events.map((e) => e.title), a.debug[0].multiget], [['하나씩 받은 일정'], 1]);
  const b = await fetchCalDav({ base, user: 'u', pass: 'p', from: '2026-11-01', to: '2026-11-30', fetchImpl: make('none') });
  assert.deepEqual([b.events.map((e) => e.title), b.debug[0].listed, b.debug[0].get], [['하나씩 받은 일정'], 1, 1]);
});
