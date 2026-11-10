import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../js/assistant.js';
import { normEvent, normTask } from '../js/agenda.js';

const now = new Date(2026, 10, 9, 9, 0); // 2026-11-09 (월)
const at = (d, h, m = 0, mins = 60) => ({ start: { dateTime: new Date(2026, 10, d, h, m).toISOString() }, end: { dateTime: new Date(2026, 10, d, h, m + mins).toISOString() } });
const cal = (summary, partner = false) => ({ id: summary, summary, partner });
const events = [
  normEvent({ id: 'a', summary: '학년 협의회', ...at(9, 15) }, cal('Work')),
  normEvent({ id: 'b', summary: '헬스', ...at(9, 19, 30) }, cal('Exercise')),
  normEvent({ id: 'c', summary: '야근', ...at(9, 20) }, cal('내 캘린더', true)),
  normEvent({ id: 'd', summary: '러닝 5km', ...at(11, 6, 30) }, cal('Exercise')),
  normEvent({ id: 'e', summary: '저녁 데이트', ...at(13, 18, 30) }, cal('Cherish')),
  normEvent({ id: 'f', summary: '어머니 생신', start: { date: '2026-11-18' }, end: { date: '2026-11-19' } }, cal('Birthday')),
];
const tasks = [
  { id: 't1', title: '교육청 공문 회신', due: '2026-11-08T00:00:00.000Z', status: 'needsAction' },
  { id: 't2', title: '수학 단원평가 채점', due: '2026-11-09T00:00:00.000Z', status: 'needsAction' },
  { id: 't3', title: '대학원 과제 제출', due: '2026-11-13T00:00:00.000Z', status: 'needsAction' },
  { id: 't4', title: '연말정산 서류', due: '2026-11-06T00:00:00.000Z', status: 'completed', completed: '2026-11-07T01:00:00.000Z' },
].map((t) => normTask(t));
const agenda = { events, tasks, until: '2026-12-10' };
const data = { fixed: [{ id: 'f1', name: '넷플릭스', day: 9, amount: 17000 }], debts: [], savings: [] };
const A = (q) => ask(q, data, {}, now, agenda).text;

test('비서: 오늘 일정 (반려자 캘린더는 맨 뒤, 나갈 돈도 함께)', () => {
  const a = A('오늘 일정 뭐야?');
  assert.match(a, /오늘 일정은 3개예요/);
  assert.ok(a.indexOf('학년 협의회') < a.indexOf('헬스') && a.indexOf('헬스') < a.indexOf('야근'));
  assert.match(a, /야근 \(반려자\)/);
  assert.match(a, /나갈 돈: 넷플릭스 17,000원/);
});

test('비서: 요일·주간·캘린더 종류·반려자', () => {
  assert.match(A('수요일에 뭐 있어?'), /러닝 5km/);
  assert.match(A('금요일 약속 있어?'), /저녁 데이트/);
  assert.match(A('이번 주 운동 일정'), /Exercise 일정은 2개예요[\s\S]*헬스[\s\S]*러닝/);
  assert.match(A('반려자 일정 알려줘'), /반려자 일정이에요[\s\S]*야근/);
  assert.match(A('내일은?'), /내일은 일정이 없어요/);
});

test('비서: 일정 제목으로 언제인지', () => {
  assert.match(A('어머니 생신 언제야?'), /어머니 생신.*11월 18일 \(수\).*9일 뒤/);
});

test('비서: 할일', () => {
  const a = A('오늘 할일 뭐야');
  assert.match(a, /오늘 할일은 1개예요[\s\S]*수학 단원평가 채점[\s\S]*지난 할일도 1개[\s\S]*교육청 공문 회신 \(1일 지남\)/);
  assert.match(A('이번 주 할일'), /이번 주 할일은 2개예요[\s\S]*대학원 과제 제출/);
  assert.match(A('밀린 할일 있어?'), /마감이 지난 할일이 1개예요/);
  assert.match(A('대학원 과제 언제까지야'), /11월 13일 \(금\)/);
  assert.match(A('최근에 끝낸 일'), /연말정산 서류/);
});

test('비서: 오늘 브리핑 · 연결 전 안내 · 자산 질문은 그대로', () => {
  const b = A('오늘 브리핑 해줘');
  assert.match(b, /학년 협의회[\s\S]*수학 단원평가/);
  assert.match(ask('오늘 일정 뭐야', data, {}, now, null).text, /연결되지 않았어요/);
  assert.match(A('넷플 언제 결제돼'), /넷플릭스는 매달 9일/);
  assert.match(A('고정지출 얼마야'), /매달 고정지출은/);
});

test('비서: 일정·할일 넣기는 확인 카드로', () => {
  const ag = { ...agenda, calendars: [{ id: 'x', name: 'Exercise' }, { id: 'w', name: 'Work' }, { id: 'l', name: 'Life' }] };
  const a = ask('금요일 7시에 헬스 일정 넣어줘', data, {}, now, ag);
  assert.equal(a.action.kind, 'event');
  assert.deepEqual([a.action.ev.title, a.action.ev.date, a.action.ev.time, a.action.ev.calName], ['헬스', '2026-11-13', '19:00', 'Exercise']);
  assert.match(a.text, /11월 13일 \(금\) 19:00~20:00 헬스[\s\S]*캘린더: Exercise/);
  const b = ask('내일 학부모 상담 잡아 줘', data, {}, now, ag);
  assert.deepEqual([b.action.ev.title, b.action.ev.date, b.action.ev.allDay, b.action.ev.calName], ['학부모 상담', '2026-11-10', true, 'Work']);
  const c = ask('우유 사기 할일 추가해줘', data, {}, now, ag);
  assert.deepEqual(c.action, { kind: 'task', title: '우유 사기', due: '2026-11-09' }); // 날짜를 말하지 않으면 오늘 할일로
  const d = ask('할일에 금요일까지 보고서 넣어줘', data, {}, now, ag);
  assert.deepEqual(d.action, { kind: 'task', title: '보고서', due: '2026-11-13' });
  assert.match(ask('헬스 넣어줘', data, {}, now, null).text, /연결되지 않았어요/);
  assert.match(A('고정지출 얼마야'), /매달 고정지출은/); // 넣기 말이 없으면 그대로
});

test('비서: 반복 일정·할일 넣기', () => {
  const ag = { ...agenda, calendars: [{ id: 'l', name: 'Life' }, { id: 'x', name: 'Exercise' }] };
  const a = ask('매주 토요일 화장실 청소 할일 추가해줘', data, {}, now, ag);
  assert.deepEqual([a.action.title, a.action.due, a.action.repeat.byday], ['화장실 청소', '2026-11-14', [6]]);
  assert.match(a.text, /반복: 매주 토요일/);
  const b = ask('매주 화요일 7시 헬스 일정 넣어줘', data, {}, now, ag);
  assert.deepEqual([b.action.ev.date, b.action.ev.time, b.action.ev.calName], ['2026-11-10', '19:00', 'Exercise']);
  assert.match(b.text, /반복: 매주 화요일/);
});

test('비서 개선 2026-11-09: 일정 옮기기·지우기', () => {
  const ev = [
    ...events,
    normEvent({ id: 'r1', summary: '연구 면담', start: { dateTime: new Date(2026, 10, 12, 16).toISOString() }, end: { dateTime: new Date(2026, 10, 12, 17).toISOString() } }, cal('Life')),
    normEvent({ id: 'r2', summary: '라스런회의', start: { dateTime: new Date(2026, 10, 12, 19).toISOString() }, end: { dateTime: new Date(2026, 10, 12, 20).toISOString() } }, cal('Life')),
  ];
  const ag = { ...agenda, events: ev, calendars: [{ id: 'Life', name: 'Life' }, { id: 'Work', name: 'Work' }] };
  const A2 = (q) => ask(q, data, {}, now, ag);
  const a = A2('목요일 연구 면담 일정을 수요일 오후 2시로 옮겨줘');
  assert.equal(a.action.kind, 'move');
  assert.deepEqual([a.action.id, a.action.to.date, a.action.to.time, a.action.to.endTime], ['r1', '2026-11-11', '14:00', '15:00']);
  assert.match(a.text, /11월 12일 \(목\) 16:00~17:00 연구 면담\n→ 11월 11일 \(수\) 14:00~15:00/);
  // 언제로 옮길지 안 말하면 되물어요
  assert.match(A2('연구 면담 일정을 옮겨달라구').text, /언제로 옮길까요/);
  // 을/를 없이, 시간만 바꾸기
  const c = A2('연구 면담 5시로 바꿔줘');
  assert.deepEqual([c.action.to.date, c.action.to.time, c.action.to.endTime], ['2026-11-12', '17:00', '18:00']);
  // 지우기
  const d = A2('라스런회의 일정 취소해줘');
  assert.deepEqual([d.action.kind, d.action.id], ['delete', 'r2']);
  // 반려자 일정은 바꿀 수 없어요
  assert.match(A2('야근 일정 지워줘').text, /반려자 캘린더 일정이라/);
});

test('비서: 메모 남기기·찾기', () => {
  const memos = [
    { id: '1', text: '와이파이 비밀번호 바뀜: 공유기 뒷면', createdAt: 2 },
    { id: '2', text: '읽을 책: 도둑맞은 집중력', createdAt: 1, pinned: true },
  ];
  const M = (q) => ask(q, data, {}, now, agenda, memos);
  assert.deepEqual(M('주차 B2 37번이라고 메모해줘').action, { kind: 'memo', text: '주차 B2 37번' });
  assert.deepEqual(M('메모: 우산 챙기기').action, { kind: 'memo', text: '우산 챙기기' });
  assert.match(M('와이파이 메모 찾아줘').text, /와이파이 비밀번호 바뀜/);
  assert.match(M('메모 보여줘').text, /메모 2개 중[\s\S]*읽을 책[\s\S]*와이파이/); // 고정 먼저
  assert.equal(M('내일 3시 상담 넣어줘').action.kind, 'event'); // 넣어줘는 그대로 일정
});

// ───── 2026-11-10 개선 요청 ─────
import { ask as ask2, pickChoice, parseTime as pt } from '../js/assistant.js';
{
  const now = new Date(2026, 10, 10, 9);
  const ag = { events: [], tasks: [], calendars: [{ name: 'Work' }, { name: 'Life' }], keywords: [] };
  const { test: t2 } = await import('node:test');
  const assert2 = (await import('node:assert/strict')).default;

  t2('날짜 + 할 거리만 말하면 일정인지 할일인지 물어봐요', () => {
    for (const [q, label] of [['12월 2일 부장회식', '12월 2일 (수)'], ['26일 동학년회식', '11월 26일 (목)']]) {
      const a = ask2(q, {}, {}, now, ag);
      assert2.match(a.text, /할일인가요, 일정인가요\?/);
      assert2.ok(a.text.includes(label), a.text);
      assert2.equal(a.choose.length, 2);
      const ev = ask2(pickChoice('일정', a.choose), {}, {}, now, ag);
      assert2.equal(ev.action.kind, 'event');
      const tk = ask2(pickChoice('할일이야', a.choose), {}, {}, now, ag);
      assert2.equal(tk.action.kind, 'task');
    }
    assert2.ok(!ask2('내일 일정 뭐야?', {}, {}, now, ag).choose);
    assert2.ok(!ask2('12월 2일 뭐 있어?', {}, {}, now, ag).choose);
    assert2.equal(pickChoice('음 글쎄', [{ label: '일정', q: 'x' }]), null);
  });

  t2("'26일', '3일 뒤'도 날짜로 알아들어요", () => {
    assert2.equal(pt('26일', now).start.getDate(), 26);
    assert2.equal(pt('5일', now).start.getMonth(), 11); // 지났으면 다음 달
    assert2.equal(pt('3일뒤', now).start.getDate(), 13);
    assert2.equal(pt('30일동안', now), null);
  });

  t2('날짜 없이 할일을 넣으면 오늘 할일로', () => {
    const a = ask2('빼빼로 사기 할일 추가', {}, {}, now, ag);
    assert2.equal(a.action.kind, 'task');
    assert2.equal(a.action.title, '빼빼로 사기');
    assert2.equal(a.action.due, '2026-11-10');
    assert2.ok(!a.action.time);
    assert2.match(a.text, /오늘 할일로/);
  });
}

// ───── 2026-11-10 개선 요청 (2) ─────
{
  const { ask: ask3, stripCommand: sc } = await import('../js/assistant.js');
  const { test: t3 } = await import('node:test');
  const assert3 = (await import('node:assert/strict')).default;
  const now = new Date(2026, 10, 10, 9); // 화요일
  const ag = { events: [], tasks: [], calendars: [{ name: 'Work' }], keywords: [] };
  t3('할일 날짜: 쉼표, 날짜+요일, 명령 뒤에 덧붙인 날짜', () => {
    for (const q of ['다음 주 화요일, 부서별 평가자료 제출 할일 추가', '17일 화요일 부서별 평가자료 제출 할일 추가', '부서별 평가자료 제출 할일 추가 11월 17일 화요일까지', '부서별 평가자료 제출 할일 추가해줘 11/17(화)']) {
      const a = ask3(q, {}, {}, now, ag);
      assert3.deepEqual(a.action, { kind: 'task', title: '부서별 평가자료 제출', due: '2026-11-17' }, q);
    }
    assert3.equal(sc('회의 일정 넣어줘 오후 2시로'), '회의 오후 2시로');
    assert3.equal(ask3('다음주 수요일 회의 일정 넣어줘 오후 2시로', {}, {}, now, ag).action.ev.time, '14:00');
  });
}
