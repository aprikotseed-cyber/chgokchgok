import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normType, parseMinutes, parseKm, parseKcal, parseWhen, fromShortcut, normWorkout, workoutsBetween, workoutTotals, weekCount,
  workoutLine, minutesLabel, weightList, bmi, bmiLabel, weightSeries, weightGoal, matchWorkouts, coachingDue, cheerText, afterText, briefingLine,
} from '../js/workouts.js';
import { goalProgress, weeklyReview } from '../js/goals.js';

test('운동 종류: 애플 운동 앱 이름(한국어·영어)을 차곡차곡 이름으로', () => {
  assert.equal(normType('실외 달리기'), '러닝');
  assert.equal(normType('Running'), '러닝');
  assert.equal(normType('실내 걷기'), '걷기');
  assert.equal(normType('전통적인 근력 강화 운동'), '헬스');
  assert.equal(normType('Functional Strength Training'), '헬스');
  assert.equal(normType('고강도 인터벌 트레이닝'), '인터벌');
  assert.equal(normType('Hiking'), '등산');
  assert.equal(normType('실외 사이클'), '사이클');
  assert.equal(normType('수영장 수영'), '수영');
  assert.equal(normType('배드민턴'), '구기');
  assert.equal(normType(''), '기타');
  assert.equal(normType('크로스핏'), '크로스핏'); // 모르는 이름은 그대로
});

test('시간·거리·칼로리: 단축어가 보내는 여러 모양', () => {
  assert.equal(parseMinutes('0:32:10'), 32);
  assert.equal(parseMinutes('32:10'), 32);
  assert.equal(parseMinutes('1시간 5분'), 65);
  assert.equal(parseMinutes('1 hr 5 min'), 65);
  assert.equal(parseMinutes('1920초'), 32);
  assert.equal(parseMinutes(1920), 32); // 큰 숫자는 초
  assert.equal(parseMinutes(45), 45);
  assert.equal(parseMinutes(''), 0);
  assert.equal(parseKm('5.12 km'), 5.12);
  assert.equal(parseKm('5,120 m'), 5.12);
  assert.equal(parseKm('3.1 mi'), 4.99);
  assert.equal(parseKm(''), 0);
  assert.equal(parseKcal('312 kcal'), 312);
  assert.equal(parseKcal('1,306 kJ'), 312);
  assert.equal(parseKcal('1,234.6 Cal'), 1235);
});

test('날짜·시각: 단축어 날짜 형식', () => {
  assert.deepEqual(parseWhen('2026-11-24 19:30'), { date: '2026-11-24', start: '19:30' });
  assert.deepEqual(parseWhen('2026. 11. 24. 오후 7:30'), { date: '2026-11-24', start: '19:30' });
  assert.deepEqual(parseWhen('2026년 11월 24일 오전 12:05'), { date: '2026-11-24', start: '00:05' });
  assert.deepEqual(parseWhen('', new Date(2026, 10, 3)), { date: '2026-11-03', start: '' });
});

test('단축어 문서 → 운동 기록', () => {
  const w = fromShortcut({ type: '실외 달리기', start: '2026-11-24 06:40', duration: '0:32:10', distance: '5.12 km', kcal: '312 kcal' });
  assert.deepEqual(w, { date: '2026-11-24', start: '06:40', type: '러닝', minutes: 32, km: 5.12, kcal: 312, source: 'watch', memo: '' });
  // 저장된 단축어 문서(via)도 같은 모양으로
  const n = normWorkout({ id: 'x', via: 'shortcut', type: 'Yoga', start: '2026-11-24 21:00', minutes: '40', kcal: '120' });
  assert.equal(n.type, '요가');
  assert.equal(n.minutes, 40);
  assert.equal(n.source, 'watch');
  // 직접 입력한 기록은 그대로
  const m = normWorkout({ id: 'y', date: '2026-11-23', type: '헬스', minutes: 50, kcal: 300, source: 'manual' });
  assert.equal(m.minutes, 50);
  assert.equal(m.source, 'manual');
});

const LOG = [
  { id: '1', date: '2026-11-17', start: '06:30', type: '러닝', minutes: 30, km: 5, kcal: 300, source: 'watch' },
  { id: '2', date: '2026-11-19', start: '19:40', type: '헬스', minutes: 60, km: 0, kcal: 350, source: 'watch' },
  { id: '3', date: '2026-11-19', start: '21:00', type: '걷기', minutes: 20, km: 1.5, kcal: 80, source: 'manual' },
  { id: '4', date: '2026-11-03', start: '', type: '러닝', minutes: 40, km: 7, kcal: 420, source: 'manual' },
];

test('합계·주간 횟수(하루 여러 번은 1회)', () => {
  const w = workoutsBetween(LOG, '2026-11-16', '2026-11-22');
  assert.equal(w.length, 3);
  assert.equal(w[0].id, '3'); // 최신순
  assert.deepEqual(workoutTotals(w), { count: 3, days: 2, minutes: 110, km: 6.5, kcal: 730 });
  assert.equal(weekCount(LOG, '2026-11-16', '2026-11-22'), 2);
  assert.equal(workoutLine(LOG[0]), '러닝 · 30분 · 5km · 300kcal');
  assert.equal(workoutLine({ type: '헬스', minutes: 65, km: 0, kcal: 0 }), '헬스 · 1시간 5분');
  assert.equal(minutesLabel(120), '2시간');
});

test('몸무게·BMI·목표 체중', () => {
  const list = weightList({ '2026-11-01': { kg: 80 }, '2026-11-20': { kg: 77.5, source: 'health' }, '2026-10-01': { kg: 81 }, bad: { kg: 0 } });
  assert.deepEqual(list.map((x) => x.date), ['2026-10-01', '2026-11-01', '2026-11-20']);
  assert.equal(list[2].source, 'health');
  assert.equal(bmi(175, 77.5), 25.3);
  assert.equal(bmiLabel(25.3), '1단계 비만');
  assert.equal(bmiLabel(22.9), '정상');
  assert.equal(bmiLabel(23), '비만 전단계');
  assert.equal(bmi(0, 70), 0);
  assert.equal(weightSeries(list, new Date(2026, 10, 24), 30).length, 2);
  const g = weightGoal(list, 75, '2026-11-01');
  assert.equal(g.start, 80);
  assert.equal(g.left, 2.5);
  assert.equal(Math.round(g.pct), 50);
  assert.equal(weightGoal(list, 0), null);
});

const kstMs = (d, hm) => new Date(`${d}T${hm}:00`).getTime(); // 테스트는 로컬 시각 기준
const AG = { events: [
  { id: 'e1', calName: 'Exercise', title: '헬스', startKey: '2026-11-19', endKey: '2026-11-19', time: '19:30', endTime: '20:30', allDay: false },
  { id: 'e2', calName: 'Exercise', title: '러닝', startKey: '2026-11-20', endKey: '2026-11-20', time: '', endTime: '', allDay: true },
  { id: 'e3', calName: 'Work', title: '회의', startKey: '2026-11-19', endKey: '2026-11-19', time: '19:00', endTime: '20:00', allDay: false },
  { id: 'e4', calName: 'exercise', title: '필라테스', startKey: '2026-11-19', endKey: '2026-11-19', time: '07:00', endTime: '08:00', allDay: false, partner: true },
] };

test('일정에 맞는 운동 기록 찾기', () => {
  assert.deepEqual(matchWorkouts(AG.events[0], LOG).map((w) => w.id), ['2', '3']);
  assert.deepEqual(matchWorkouts({ ...AG.events[0], time: '06:00', endTime: '07:00' }, LOG).map((w) => w.id), []);
  assert.deepEqual(matchWorkouts(AG.events[1], LOG), []); // 20일엔 기록 없음
});

test('코칭: 30분 전 응원, 끝나고 1시간 뒤 칭찬·재촉, 한 번만', () => {
  const at = (d, hm) => kstMs(d, hm);
  let due = coachingDue(AG, LOG, at('2026-11-19', '19:05'), {}, kstMs);
  assert.deepEqual(due.map((x) => x.kind), ['cheer']);
  assert.equal(due[0].ev.id, 'e1'); // 업무·반려자 일정은 빼요
  assert.deepEqual(coachingDue(AG, LOG, at('2026-11-19', '19:05'), { [due[0].key]: 1 }, kstMs), []);
  due = coachingDue(AG, LOG, at('2026-11-19', '21:35'), {}, kstMs);
  assert.deepEqual(due.map((x) => x.kind), ['after']);
  assert.equal(due[0].done.length, 2);
  assert.match(afterText(due[0].ev, due[0].done).title, /완료/);
  assert.deepEqual(coachingDue(AG, LOG, at('2026-11-19', '20:50'), {}, kstMs), []); // 아직 1시간 안 됨
  assert.deepEqual(coachingDue(AG, LOG, at('2026-11-20', '20:00'), {}, kstMs), []); // 종일 일정은 저녁 9시부터
  due = coachingDue(AG, LOG, at('2026-11-20', '21:10'), {}, kstMs);
  assert.equal(due.length, 1);
  assert.match(afterText(due[0].ev, due[0].done).title, /어땠어요/);
  const c = cheerText(AG.events[0], { weekDone: 1, goal: 3 });
  assert.match(c.body, /19:30 ‘헬스’/);
  assert.match(c.body, /이번 주 1\/3회/);
  assert.match(cheerText(AG.events[0], { weekDone: 3, goal: 3 }).body, /목표 3회 달성이에요/);
  assert.match(cheerText(AG.events[0], { weekDone: 4, goal: 3 }).body, /이미 달성/);
  assert.match(afterText(AG.events[0], LOG.slice(1, 2), { weekDone: 3, goal: 3 }).body, /이미 달성/);
});

test('아침 브리핑 운동 줄', () => {
  assert.equal(briefingLine(AG, LOG, new Date(2026, 10, 19), 3, '2026-11-16'), '└ 운동 : 19:30 헬스 · 이번 주 2/3회');
  assert.equal(briefingLine(AG, LOG, new Date(2026, 10, 21), 3, '2026-11-16'), '└ 운동 : 이번 주 2/3회');
  assert.equal(briefingLine(AG, LOG, new Date(2026, 10, 21), 0, '2026-11-16'), null);
  assert.equal(briefingLine(AG, LOG, new Date(2026, 10, 20), 0), '└ 운동 : 러닝');
});

test('목표: 운동 일지로 세기 (주 N회·거리·칼로리·체중)', () => {
  const today = new Date(2026, 10, 22);
  const data = { body: { height: 175, goalWeight: 75 } };
  const weights = { '2026-01-05': { kg: 82 }, '2026-11-20': { kg: 78 } };
  const ctx = { data, today, workouts: LOG, weights, agenda: AG };
  assert.equal(goalProgress({ kind: 'exercise', targetCount: 3 }, ctx).current, 2);
  // 운동 일지가 비어 있으면 Exercise 캘린더 일정으로
  assert.equal(goalProgress({ kind: 'exercise', targetCount: 3 }, { ...ctx, workouts: [] }).current, 2);
  const d = goalProgress({ kind: 'distance', targetKm: 500 }, ctx);
  assert.equal(d.current, 13.5);
  assert.match(d.text, /13.5km \/ 500km/);
  const k = goalProgress({ kind: 'kcal', targetKcal: 5000 }, ctx);
  assert.equal(k.current, 1150);
  const w = goalProgress({ kind: 'weight' }, ctx); // 목표 체중은 몸 정보에서
  assert.equal(w.current, 78);
  assert.equal(w.sub, '목표까지 3kg');
  assert.equal(Math.round(w.pct), 57);
  assert.equal(goalProgress({ kind: 'weight', targetKg: 70 }, { ...ctx, weights: {} }).text, '아직 몸무게 기록이 없어요');
});

test('주간 돌아보기: 운동 일지 + 계획', () => {
  const r = weeklyReview({ data: { goals: [{ kind: 'exercise', targetCount: 2, title: '운동' }] }, agenda: AG, tasks: [], today: new Date(2026, 10, 22), workouts: LOG });
  assert.match(r.body, /└ 운동 2회 \(계획 2회 · 1시간 50분 · 730kcal\) · 목표 주 2회 달성/);
});
