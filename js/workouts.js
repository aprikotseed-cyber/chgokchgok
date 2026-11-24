// 운동 일지 · 몸무게 (화면·서버·테스트가 함께 쓰는 순수 함수)
// 운동: users/{uid}/workouts  { date, start, type, minutes, km, kcal, source, memo, createdAt }
//  - source: 'watch'(애플워치·단축어) | 'manual'(직접 입력)
// 몸무게: users/{uid}/weights  문서 이름 = 'YYYY-MM-DD'  { kg, source, at }
//  - source: 'manual'(직접 입력) | 'health'(건강 앱·스마트 체중계, 나중에 단축어로)
// 키·목표 체중: data/main 의 body { height, goalWeight }

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 운동 종류: 고르는 목록 (직접 입력 창) */
export const WORKOUT_TYPES = ['러닝', '걷기', '헬스', '사이클', '수영', '요가', '필라테스', '등산', '인터벌', '홈트', '구기', '기타'];

// 애플 운동 앱 이름(한국어·영어) → 차곡차곡 이름
const TYPE_MAP = [
  [/run|러닝|달리기|조깅/i, '러닝'],
  [/walk|걷기|산책/i, '걷기'],
  [/hik|하이킹|등산|트레킹/i, '등산'],
  [/strength|근력|웨이트|헬스|gym|core|코어/i, '헬스'],
  [/cycl|bik|사이클|자전거|스피닝/i, '사이클'],
  [/swim|수영/i, '수영'],
  [/yoga|요가/i, '요가'],
  [/pilates|필라테스/i, '필라테스'],
  [/hiit|interval|인터벌|고강도/i, '인터벌'],
  [/tennis|badminton|soccer|basketball|volleyball|table tennis|squash|golf|테니스|배드민턴|축구|농구|배구|탁구|스쿼시|골프/i, '구기'],
  [/elliptical|rowing|stair|일립티컬|로잉|계단|홈트|home|dance|댄스|fitness|피트니스|mixed|cardio|유산소|cooldown|쿨다운|flexibility|유연성/i, '홈트'],
];
/** 운동 종류 이름 맞추기 (모르는 이름은 그대로) */
export function normType(raw) {
  const s = String(raw || '').trim();
  if (!s) return '기타';
  if (WORKOUT_TYPES.includes(s)) return s;
  for (const [re, v] of TYPE_MAP) if (re.test(s)) return v;
  return s.slice(0, 20);
}

/** '1,234.5 kcal' → 1234.5 (못 읽으면 0) */
function readNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const m = String(v || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/**
 * 운동 시간 → 분
 * '0:32:10', '32:10', '32분', '1시간 5분', '1 hr 5 min', '1920초', '1920 s', 32, 1920(초로 보이면)
 */
export function parseMinutes(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v > 600 ? v / 60 : v); // 600보다 크면 초로 봐요 (10시간 넘는 운동은 없으니)
  const s = String(v).trim();
  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const [a, b, c] = [colon[1], colon[2], colon[3]].map((x) => Number(x || 0));
    return Math.round(colon[3] != null ? a * 60 + b + c / 60 : a + b / 60); // h:mm:ss 또는 mm:ss
  }
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:시간|hours?|hrs?|h\b)/i);
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:분|minutes?|mins?|m\b)/i);
  const sec = s.match(/(\d+(?:\.\d+)?)\s*(?:초|seconds?|secs?|s\b)/i);
  if (h || m || sec) return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) + (sec ? Number(sec[1]) / 60 : 0));
  return parseMinutes(readNumber(s));
}

/** 거리 → km ('5.12 km', '5120 m', '3.1 mi', 5.12) */
export function parseKm(v) {
  if (v == null || v === '') return 0;
  const s = String(v).toLowerCase();
  const n = readNumber(v);
  if (/mi\b|mile|마일/.test(s)) return Math.round(n * 1.609344 * 100) / 100;
  if (/(^|[\d\s])m\b|미터/.test(s) && !/km|킬로/.test(s)) return Math.round(n / 10) / 100;
  return Math.round(n * 100) / 100;
}

/** 칼로리 → kcal ('312 kcal', '312 Cal', '1,306 kJ') */
export function parseKcal(v) {
  const n = readNumber(v);
  if (/kj|킬로줄/i.test(String(v))) return Math.round(n / 4.184);
  return Math.round(n);
}

/** 날짜·시각 글자 → { date:'YYYY-MM-DD', start:'HH:MM' }
 *  '2026-11-24 19:30' (단축어 '날짜 형식 지정'), '2026. 11. 24. 오후 7:30', '2026년 11월 24일 오후 7:30' */
export function parseWhen(v, fallback = new Date()) {
  const s = String(v || '').trim();
  const d = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  const date = d ? `${d[1]}-${pad(Number(d[2]))}-${pad(Number(d[3]))}` : key(fallback);
  const rest = d ? s.slice(d.index + d[0].length) : s;
  const t = rest.match(/(\d{1,2}):(\d{2})/);
  let start = '';
  if (t) {
    let hh = Number(t[1]);
    if (/오후|pm/i.test(rest) && hh < 12) hh += 12;
    if (/오전|am/i.test(rest) && hh === 12) hh = 0;
    if (hh < 24 && Number(t[2]) < 60) start = `${pad(hh)}:${t[2]}`;
  }
  return { date, start };
}

/**
 * 단축어가 넣은 문서(글자 칸) → 운동 기록
 * 칸 이름은 넉넉하게 받아요: type/종류, duration/minutes/시간, distance/km/거리, kcal/calories/칼로리, start/date/시작
 */
export function fromShortcut(raw, now = new Date()) {
  const pick = (...names) => { for (const n of names) if (raw?.[n] != null && raw[n] !== '') return raw[n]; return ''; };
  const when = parseWhen(pick('start', 'date', '시작', '날짜'), now);
  return {
    date: when.date,
    start: when.start,
    type: normType(pick('type', '종류', 'workout')),
    minutes: parseMinutes(pick('minutes', 'duration', '시간', '운동 시간')),
    km: parseKm(pick('km', 'distance', '거리')),
    kcal: parseKcal(pick('kcal', 'calories', 'energy', '칼로리', '활동 칼로리')),
    source: 'watch',
    memo: '',
  };
}

/** 저장해 둔 운동 기록 고르기 (단축어가 넣은 글자 칸이면 바꿔서) */
export function normWorkout(w, now = new Date()) {
  if (!w) return null;
  if (w.via === 'shortcut' || (typeof w.minutes === 'string' && !w.source)) return { id: w.id, ...fromShortcut(w, now), createdAt: w.createdAt || 0 };
  return { id: w.id, date: w.date || key(now), start: w.start || '', type: normType(w.type), minutes: num(w.minutes), km: num(w.km), kcal: num(w.kcal), source: w.source || 'manual', memo: w.memo || '', createdAt: w.createdAt || 0 };
}

/** 기간 안의 운동 (날짜 최신순) */
export function workoutsBetween(list, start, end) {
  return (list || []).filter((w) => w.date >= start && w.date <= end).sort((a, b) => b.date.localeCompare(a.date) || String(b.start).localeCompare(String(a.start)));
}

/** 합계 { count(운동한 횟수), days(운동한 날), minutes, km, kcal } */
export function workoutTotals(list) {
  const l = list || [];
  return {
    count: l.length,
    days: new Set(l.map((w) => w.date)).size,
    minutes: l.reduce((a, w) => a + num(w.minutes), 0),
    km: Math.round(l.reduce((a, w) => a + num(w.km), 0) * 100) / 100,
    kcal: l.reduce((a, w) => a + num(w.kcal), 0),
  };
}

/** 주간 목표 '주 N회'는 운동한 날 수로 세요 (하루 두 번 해도 1회) */
export const weekCount = (list, start, end) => new Set((list || []).filter((w) => w.date >= start && w.date <= end).map((w) => w.date)).size;

/** Exercise 캘린더 일정 (반려자 일정 빼고) = 계획 */
export const isExerciseEvent = (e) => !e.partner && String(e.calName || '').toLowerCase() === 'exercise';
export function plannedBetween(agenda, start, end) {
  return (agenda?.events || []).filter((e) => isExerciseEvent(e) && e.startKey >= start && e.startKey <= end);
}

/** '1시간 5분' / '45분' */
export function minutesLabel(m) {
  const n = Math.round(num(m));
  if (!n) return '';
  return n >= 60 ? `${Math.floor(n / 60)}시간${n % 60 ? ` ${n % 60}분` : ''}` : `${n}분`;
}
/** 운동 한 줄: '러닝 · 32분 · 5.1km · 312kcal' */
export function workoutLine(w) {
  return [w.type, minutesLabel(w.minutes), num(w.km) ? `${num(w.km).toFixed(num(w.km) < 10 ? 2 : 1).replace(/\.?0+$/, '')}km` : '', num(w.kcal) ? `${Math.round(w.kcal).toLocaleString('ko-KR')}kcal` : ''].filter(Boolean).join(' · ');
}

// ───── 몸무게 · BMI ─────
/** 몸무게 기록 {날짜: {kg}} → 날짜순 [{date, kg, source}] */
export function weightList(map) {
  return Object.entries(map || {}).filter(([, v]) => num(v?.kg) > 0).map(([date, v]) => ({ date, kg: Math.round(num(v.kg) * 10) / 10, source: v.source || 'manual' })).sort((a, b) => a.date.localeCompare(b.date));
}
export const latestWeight = (list) => (list?.length ? list[list.length - 1] : null);

/** BMI (키 cm, 몸무게 kg) */
export function bmi(heightCm, kg) {
  const h = num(heightCm) / 100;
  return h > 0 && num(kg) > 0 ? Math.round((kg / (h * h)) * 10) / 10 : 0;
}
/** 대한비만학회 기준 */
export function bmiLabel(b) {
  if (!b) return '';
  if (b < 18.5) return '저체중';
  if (b < 23) return '정상';
  if (b < 25) return '비만 전단계';
  if (b < 30) return '1단계 비만';
  if (b < 35) return '2단계 비만';
  return '3단계 비만';
}

/** 그래프 기간 안의 몸무게 (range: 30 | 90 | 365일) */
export function weightSeries(list, today, range = 30) {
  const from = key(addDays(today, -range + 1));
  return (list || []).filter((w) => w.date >= from && w.date <= key(today));
}

/** 목표 체중까지: { left(kg, +면 더 빼야 함), pct(시작 몸무게 기준 진행률) } */
export function weightGoal(list, goalKg, sinceKey = '') {
  const g = num(goalKg);
  const last = latestWeight(list);
  if (!g || !last) return null;
  const from = (list || []).find((w) => !sinceKey || w.date >= sinceKey) || list[0];
  const left = Math.round((last.kg - g) * 10) / 10;
  const span = from.kg - g;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((from.kg - last.kg) / span) * 100)) : left <= 0 ? 100 : 0;
  return { start: from.kg, current: last.kg, goal: g, left, pct };
}

// ───── 코칭 (알림 문구) ─────
const CHEERS = [
  '오늘도 몸을 위한 시간, 가볍게 시작해 봐요.',
  '시작이 제일 어려워요. 일단 나가기만 하면 반은 한 거예요.',
  '오늘 운동이 내일의 덕준님을 가볍게 만들어 줄 거예요.',
  '무리하지 말고, 할 수 있는 만큼만 해도 충분해요.',
  '수업하느라 고생한 몸, 이번엔 덕준님 자신을 위해 써 봐요.',
  '조금 귀찮아도 끝나고 나면 분명 기분 좋을 거예요.',
];
const PRAISES = [
  '정말 잘했어요! 오늘도 약속을 지켰네요.',
  '멋져요. 이렇게 쌓이는 하루하루가 큰 차이를 만들어요.',
  '수고했어요! 물 한 잔 마시고 푹 쉬어요.',
  '오늘도 해냈네요. 스스로를 칭찬해 줘도 돼요.',
];
const NUDGES = [
  '아직 운동 기록이 없어요. 혹시 바빴다면 괜찮아요. 10분 스트레칭만 해도 좋아요.',
  '오늘 계획했던 운동, 못 했다면 내일 다시 하면 돼요. 했다면 기록만 남겨 주세요.',
  '운동 기록이 아직 안 보여요. 가볍게 걷기라도 어때요?',
];
const pickBy = (list, seed) => list[Math.abs([...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % list.length];

/** 이번 주 몇 번째인지 + 목표 */
function weekNote(done, goal) {
  if (!goal) return '';
  if (done >= goal) return ` 이번 주 목표 ${goal}회는 이미 달성했어요!`;
  return ` 이번 주 ${done}/${goal}회예요.`;
}

/** 운동 30분 전: 응원. weekDone = 이번 운동을 하면 이번 주 몇 번째인지 */
export function cheerText(ev, { weekDone = 0, goal = 0 } = {}) {
  let note = '';
  if (goal && weekDone > goal) note = ` 이번 주 목표 ${goal}회는 이미 달성했어요. 오늘은 보너스예요!`;
  else if (goal && weekDone === goal) note = ` 오늘 하면 이번 주 목표 ${goal}회 달성이에요!`;
  else if (goal && weekDone) note = ` 오늘 하면 이번 주 ${weekDone}/${goal}회예요.`;
  return {
    title: '💪 30분 뒤 운동',
    body: `덕준님, ${ev.time} ‘${ev.title}’ 시간이 다가와요. ${pickBy(CHEERS, ev.startKey + ev.title)}${note}`,
  };
}

/** 운동 끝나고 1시간 뒤: 기록이 있으면 칭찬, 없으면 살짝 */
export function afterText(ev, done, { weekDone = 0, goal = 0 } = {}) {
  if (done?.length) {
    const t = workoutTotals(done);
    const what = done.length === 1 ? workoutLine(done[0]) : `${done.length}번 · ${minutesLabel(t.minutes)}${t.kcal ? ` · ${t.kcal.toLocaleString('ko-KR')}kcal` : ''}`;
    return { title: '👏 오늘 운동 완료', body: `${what}. ${pickBy(PRAISES, ev.startKey)}${weekNote(weekDone, goal)}` };
  }
  return { title: '🏃 오늘 운동은 어땠어요?', body: pickBy(NUDGES, ev.startKey) };
}

/**
 * 이 일정에 맞는 운동 기록: 같은 날, 시작 시각을 알면 일정 2시간 전 ~ 끝나고 3시간 뒤 사이
 * (시각을 모르는 기록·종일 일정은 같은 날이면 맞다고 봐요)
 */
export function matchWorkouts(ev, list) {
  const toMin = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); return h * 60 + (m || 0); };
  return (list || []).filter((w) => {
    if (w.date !== ev.startKey) return false;
    if (ev.allDay || !ev.time || !w.start) return true;
    const s = toMin(w.start);
    return s >= toMin(ev.time) - 120 && s <= toMin(ev.endTime || ev.time) + 180;
  });
}

/**
 * 지금 보낼 운동 코칭 [{key, kind:'cheer'|'after', ev, done}]
 *  - cheer: 시간 있는 Exercise 일정 시작 30분 전 ~ 시작 전
 *  - after: 끝나고 1시간 ~ 4시간 사이 (종일 일정은 그날 저녁 9시 ~ 자정)
 * kstMs(dateKey, 'HH:MM') → 그 시각의 ms
 */
export function coachingDue(agenda, list, nowMs, sent, kstMs) {
  const out = [];
  const today = key(new Date(nowMs));
  for (const ev of (agenda?.events || []).filter(isExerciseEvent)) {
    if (ev.startKey !== today) continue;
    if (!ev.allDay && ev.time) {
      const start = kstMs(ev.startKey, ev.time);
      const end = kstMs(ev.endKey || ev.startKey, ev.endTime || ev.time);
      const ck = `c:${ev.id}:${ev.startKey}`;
      if (start > nowMs && start - nowMs <= 30 * 60_000 && !sent[ck]) out.push({ key: ck, kind: 'cheer', ev });
      const ak = `a:${ev.id}:${ev.startKey}`;
      if (nowMs - end >= 60 * 60_000 && nowMs - end <= 4 * 3600_000 && !sent[ak]) out.push({ key: ak, kind: 'after', ev, done: matchWorkouts(ev, list) });
    } else {
      const ak = `a:${ev.id}:${ev.startKey}`;
      if (nowMs >= kstMs(today, '21:00') && !sent[ak]) out.push({ key: ak, kind: 'after', ev, done: matchWorkouts(ev, list) });
    }
  }
  // 같은 날 Exercise 일정이 여럿이어도 '끝나고' 알림은 하나만
  const afters = out.filter((x) => x.kind === 'after');
  return [...out.filter((x) => x.kind === 'cheer'), ...afters.slice(-1)].map((x) => (x.kind === 'after' ? { ...x, also: afters.slice(0, -1).map((y) => y.key) } : x));
}

/** 아침 브리핑 한 줄: '└ 운동 : 19:30 헬스 · 이번 주 2/3회' (오늘 운동 일정이 없고 목표도 없으면 null) */
export function briefingLine(agenda, list, today, goal = 0, weekStart = '') {
  const t = key(today);
  const evs = plannedBetween(agenda, t, t).map((e) => `${e.allDay ? '' : `${e.time} `}${e.title}`);
  if (!evs.length && !goal) return null;
  const done = weekStart ? weekCount(list, weekStart, t) : 0;
  const parts = evs.length ? [evs.join(', ')] : [];
  if (goal) parts.push(`이번 주 ${done}/${goal}회`);
  return `└ 운동 : ${parts.join(' · ')}`;
}
