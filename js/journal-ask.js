// 비서: 기록(일기 · 독서 · 운동 · 몸무게) 질문에 답해요.
// data에 함께 넘겨받는 것: books, workouts, weights, diaryLog({날짜: {happy, moved, thanks, worry: true/false}})
// 고민거리 내용은 비서에게 넘어오지 않아요 (있는지만). 그래서 비서도 고민거리는 절대 보여 줄 수 없어요.
import { weekOf, goalProgress } from './goals.js?v=20261126a';
import { normWorkout, workoutsBetween, workoutTotals, weekCount, minutesLabel, workoutLine, weightList, latestWeight, bmi, bmiLabel, weightGoal, plannedBetween, normType } from './workouts.js?v=20261126a';
import { booksReadIn, shelfOrder } from './books.js?v=20261126a';

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const mdw = (s) => { const d = fromKey(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
const nf = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const km = (n) => `${(Math.round((Number(n) || 0) * 10) / 10).toLocaleString('ko-KR')}km`;
const ask1 = (label) => ({ label, q: label });
const 은 = (w) => { const c = String(w).slice(-1).charCodeAt(0) - 0xac00; return `‘${w}’${c >= 0 && c <= 11171 && c % 28 ? '은' : '는'}`; };

// ───── 무엇을 묻는지 ─────
const BOOK_RE = /책|(?<!구)독서|완독|읽은|읽었|읽는|읽고있|읽고싶|읽을|인상깊은문장|좋은문장|밑줄|한줄감상|별점/;
const WEIGHT_RE = /몸무게|체중|bmi|비만|감량|살빠|살쪘|살이빠|살이쪘|몇키로|몇kg/;
// 운동 '기록'을 묻는 말 (일정을 묻는 '운동 몇 시야', '내일 운동 있어'는 일정 쪽)
const WORKOUT_RE = /운동(을|은|한|했|기록|일지|량|횟수|시간|얼마|몇번|몇회|몇일|며칠)|몇번운동|몇번했|칼로리|kcal|소모|운동한|운동했|뛰었|달렸|뛴거|달린거|걸은거|러닝(을|은|한|했|몇|얼마)|헬스(한|했|몇번)|등산(한|했|몇번)|수영(한|했|몇번)|마지막운동|최근운동|운동거리|몇km|몇키로뛰|얼마나뛰|얼마나달(렸|린)/;
const DIARY_RE = /일기|고민거리/;

/** 기록 질문이면 { via, text, chips } / 아니면 null */
export function journalAnswer(ctx) {
  const q = ctx.q;
  const d = ctx.data || {};
  // 일정·할일 이름을 통째로 말하면 그쪽 ('읽고 싶은 책 정리 언제까지야' → 할일)
  const nk = (s) => String(s || '').toLowerCase().replace(/[\s·.,!?~'"()\-_/]+/g, '');
  const named = (ctx.ents || []).some((e) => ['event', 'task'].includes(e.type) && q.includes(nk(e.name)));
  if (DIARY_RE.test(q) && !named) return { via: 'diary', ...diaryAnswer(ctx) };
  if (WEIGHT_RE.test(q)) return { via: 'weight', ...weightAnswer(ctx) };
  if (WORKOUT_RE.test(q) && !/일정|약속|스케줄|넣어|추가|잡아/.test(q)) return { via: 'workout', ...workoutAnswer(ctx) };
  const book = findBook(q, d.books);
  if ((BOOK_RE.test(q) || book) && !named) return { via: 'books', ...booksAnswer(ctx, book) };
  return null;
}

/** 기간: 말한 때가 있으면 그때(오늘까지), 없으면 기본값 */
function period(ctx, fallback = 'week') {
  const today = ctx.now;
  const t = ctx.time;
  const wk = weekOf(today);
  const back = (n) => key(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  if (/그저께|그제/.test(ctx.q)) return { start: back(2), end: back(2), label: '그저께' };
  if (/어제/.test(ctx.q)) return { start: back(1), end: back(1), label: '어제' };
  if (/이번주|금주|일주일|한주/.test(ctx.q)) return { start: wk.start, end: key(today), label: '이번 주' };
  if (/지난주|저번주/.test(ctx.q)) { const s = new Date(wk.mon.getFullYear(), wk.mon.getMonth(), wk.mon.getDate() - 7); return { start: key(s), end: key(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6)), label: '지난주' }; }
  if (/지난달|저번달/.test(ctx.q)) { const s = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { start: key(s), end: key(new Date(today.getFullYear(), today.getMonth(), 0)), label: `${s.getMonth() + 1}월` }; }
  if (/작년|지난해/.test(ctx.q)) { const y = today.getFullYear() - 1; return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}년` }; }
  if (/올해|금년|올한해/.test(ctx.q)) { const y = today.getFullYear(); return { start: `${y}-01-01`, end: key(today), label: `${y}년` }; }
  if (!t && fallback === 'week') return { start: wk.start, end: key(today), label: '이번 주' };
  if (/이번달|이달|한달/.test(ctx.q) || (!t && fallback === 'month')) return { start: key(new Date(today.getFullYear(), today.getMonth(), 1)), end: key(today), label: `${today.getMonth() + 1}월` };
  if (t) {
    let s = t.start;
    let e = t.end;
    // 기록은 지난 일: 앞으로의 날짜로 읽혔으면 지난 쪽으로 (예: 오늘이 13일인데 '20일 일기' → 지난달 20일)
    if (t.kind === 'day' && s > today) { s = /\d{1,2}월\d{1,2}일/.test(ctx.q) ? new Date(s.getFullYear() - 1, s.getMonth(), s.getDate()) : new Date(s.getFullYear(), s.getMonth() - 1, s.getDate()); e = s; }
    return { start: key(s), end: key(e > today ? today : e), label: t.kind === 'day' ? (key(s) === key(today) ? '오늘' : mdw(key(s))) : t.label || '그 기간' };
  }
  return { start: wk.start, end: key(today), label: '이번 주' };
}

// ───── 운동 ─────
const TYPE_WORDS = [['러닝', /러닝|달리기|달린|뛴|뛰었|달렸|조깅/], ['걷기', /걷기|걸은|산책/], ['헬스', /헬스|웨이트|근력/], ['등산', /등산|하이킹/], ['수영', /수영/], ['사이클', /자전거|사이클/], ['요가', /요가/], ['필라테스', /필라테스/]];

function workoutAnswer(ctx) {
  const all = (ctx.data.workouts || []).map((w) => normWorkout(w, ctx.now)).filter(Boolean);
  if (!all.length) return { text: '아직 운동 기록이 없어요. 기록 → 운동에서 ‘+ 운동 기록’으로 넣거나, 애플워치 단축어를 켜 두면 운동이 끝날 때 저절로 들어와요.' };
  const q = ctx.q;
  // '마지막 운동 언제야', '최근 운동'
  if (/마지막|최근|언제했|언제운동|언제마지막/.test(q) && !ctx.time) {
    const last = workoutsBetween(all, '0000-00-00', key(ctx.now))[0];
    if (!last) return { text: '아직 지난 운동 기록이 없어요.' };
    const days = Math.round((ctx.now - fromKey(last.date)) / 86400000);
    return { text: `마지막 운동은 ${mdw(last.date)}${last.start ? ` ${last.start}` : ''}, ${days === 0 ? '오늘이에요' : days === 1 ? '어제예요' : `${days}일 전이에요`}.\n· ${workoutLine(last)}`, chips: [ask1('이번 주 운동 몇 번 했어?')] };
  }
  const type = TYPE_WORDS.find(([, re]) => re.test(q))?.[0];
  const p = period(ctx, 'week');
  const list = workoutsBetween(all, p.start, p.end).filter((w) => !type || normType(w.type) === type);
  const t = workoutTotals(list);
  const what = type ? `${p.label} ${type}` : `${p.label} 운동`;
  if (!list.length) return { text: `${what} 기록은 아직 없어요.${type ? '' : ' 가볍게 10분 걷기부터 어때요?'}`, chips: [ask1('마지막 운동 언제야?')] };
  const lines = [];
  // 무엇을 물었는지에 맞춰 첫 줄
  if (/칼로리|kcal|소모/.test(q)) lines.push(`${what}으로 쓴 칼로리는 ${nf(t.kcal)}kcal이에요.`);
  else if (/거리|km|키로|얼마나뛰|얼마나달(렸|린)/.test(q)) lines.push(`${what} 거리는 모두 ${km(t.km)}예요.`);
  else if (/시간|얼마나했/.test(q)) lines.push(`${what} 시간은 모두 ${minutesLabel(t.minutes) || '0분'}이에요.`);
  else lines.push(`${what}은 ${t.days === t.count ? `${t.count}번` : `${t.days}일 동안 ${t.count}번`} 했어요.`);
  lines.push(`· ${[`${t.count}번`, minutesLabel(t.minutes), t.km ? km(t.km) : '', t.kcal ? `${nf(t.kcal)}kcal` : ''].filter(Boolean).join(' · ')}`);
  // 이번 주면: 목표·계획과 함께
  const wk = weekOf(ctx.now);
  if (p.start === wk.start && !type) {
    const goal = Number((ctx.data.goals || []).find((g) => g.kind === 'exercise')?.targetCount) || 0;
    const plan = plannedBetween(ctx.agenda, wk.start, wk.end).length;
    const done = weekCount(all, wk.start, wk.end);
    if (goal) lines.push(`· 목표 주 ${goal}회 중 ${done}회${done >= goal ? ', 달성했어요!' : `, ${goal - done}번 남았어요.`}`);
    if (plan) lines.push(`· 캘린더에 잡아 둔 운동 ${plan}번`);
  }
  lines.push(...list.slice(0, 5).map((w) => `· ${mdw(w.date).replace(/ \(.\)$/, '')} ${workoutLine(w)}`));
  if (list.length > 5) lines.push(`· 그 밖에 ${list.length - 5}번`);
  return { text: lines.join('\n'), chips: [ask1('이번 달 운동 칼로리 얼마야?'), ask1('몸무게 얼마야?')] };
}

// ───── 몸무게 ─────
function weightAnswer(ctx) {
  const list = weightList(ctx.data.weights);
  const last = latestWeight(list);
  if (!last) return { text: '아직 몸무게 기록이 없어요. 기록 → 운동의 ‘몸’에서 ‘+ 몸무게’로 넣어 주세요.' };
  const body = ctx.data.body || {};
  const goalKg = Number(body.goalWeight) || Number((ctx.data.goals || []).find((g) => g.kind === 'weight')?.targetKg) || 0;
  const b = bmi(body.height, last.kg);
  const lines = [`최근 몸무게는 ${last.kg}kg이에요. (${mdw(last.date)}${last.source === 'health' ? ', 건강 앱' : ''})`];
  if (b) lines.push(`· BMI ${b} (${bmiLabel(b)})`);
  else if (/bmi|비만/.test(ctx.q)) lines.push('· 키를 넣어 두면 BMI도 알려 드려요. (기록 → 운동 → 키·목표)');
  const g = weightGoal(list, goalKg, `${ctx.now.getFullYear()}-01-01`);
  if (g) lines.push(g.left > 0 ? `· 목표 ${g.goal}kg까지 ${g.left}kg 남았어요.` : `· 목표 ${g.goal}kg에 닿았어요!`);
  const monthAgo = key(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() - 30));
  const before = list.filter((w) => w.date <= monthAgo).at(-1) || list[0];
  if (before && before.date !== last.date) {
    const diff = Math.round((last.kg - before.kg) * 10) / 10;
    lines.push(`· ${mdw(before.date)} ${before.kg}kg보다 ${diff === 0 ? '그대로예요' : diff < 0 ? `${-diff}kg 빠졌어요` : `${diff}kg 늘었어요`}.`);
  }
  return { text: lines.join('\n'), chips: [ask1('이번 주 운동 몇 번 했어?')] };
}

// ───── 독서 ─────
const STAR = (n) => (Number(n) ? '★'.repeat(Number(n)) : '');
function findBook(q, books) {
  let best = null;
  for (const b of books || []) {
    const t = String(b.title || '').toLowerCase().replace(/[\s·.,!?~'"()\-_/]+/g, '');
    if (t.length >= 2 && q.includes(t) && (!best || t.length > best.len)) best = { book: b, len: t.length };
  }
  return best?.book || null;
}
function bookCard(b) {
  const lines = [`『${b.title}』${b.author ? ` ${b.author}` : ''}`];
  const st = b.status === 'done' ? `다 읽음${b.end ? ` (${mdw(b.end)})` : ''}` : b.status === 'reading' ? `읽는 중${b.start ? ` (${mdw(b.start)}부터)` : ''}` : '읽고 싶은 책';
  lines.push(`· ${st}${STAR(b.rating) ? ` · ${STAR(b.rating)}` : ''}`);
  if (String(b.review || '').trim()) lines.push(`· 한 줄 감상: ${b.review.trim()}`);
  const qs = (b.quotes || []).filter((x) => String(x.text || '').trim());
  if (qs.length) lines.push('· 인상 깊은 문장', ...qs.slice(0, 3).map((x) => `  “${x.text.trim()}”${String(x.page || '').trim() ? ` (p. ${String(x.page).trim()})` : ''}`));
  return lines.join('\n');
}

function booksAnswer(ctx, book) {
  const books = ctx.data.books || [];
  const q = ctx.q;
  if (book) return { text: bookCard(book) };
  if (!books.length) return { text: '아직 책장이 비어 있어요. 기록 → 독서에서 ‘+ 책 추가’로 넣어 주세요.' };
  const y = ctx.now.getFullYear();
  const yearAsked = /재작년/.test(q) ? y - 2 : /작년|지난해/.test(q) ? y - 1 : Number(q.match(/(20\d\d)년/)?.[1]) || (ctx.time?.kind === 'year' ? ctx.time.year : 0);
  const done = shelfOrder(books, 'done');
  const reading = shelfOrder(books, 'reading');
  const want = shelfOrder(books, 'want');
  const titles = (l, n = 5) => l.slice(0, n).map((b) => `· ${b.title}${STAR(b.rating) ? ` ${STAR(b.rating)}` : ''}`).join('\n') + (l.length > n ? `\n· 그 밖에 ${l.length - n}권` : '');
  if (/읽고싶|읽을책|읽을거|위시/.test(q)) return { text: want.length ? `읽고 싶은 책 ${want.length}권이에요.\n${titles(want)}` : '읽고 싶은 책으로 넣어 둔 책이 없어요.' };
  if (/읽는|읽고있|읽는중/.test(q) && !/읽은|읽었/.test(q)) return { text: reading.length ? `지금 읽는 책 ${reading.length}권이에요.\n${titles(reading)}` : '지금 읽는 중인 책이 없어요.', chips: [ask1('올해 몇 권 읽었어?')] };
  if (/인상깊은문장|좋은문장|명언|문장/.test(q)) {
    const qs = books.flatMap((b) => (b.quotes || []).filter((x) => String(x.text || '').trim()).map((x) => ({ ...x, title: b.title, at: b.end || b.start || '' }))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { text: qs.length ? `남겨 둔 인상 깊은 문장이에요.\n${qs.slice(0, 5).map((x) => `· “${x.text.trim()}” — 『${x.title}』${String(x.page || '').trim() ? ` p. ${String(x.page).trim()}` : ''}`).join('\n')}` : '아직 남긴 인상 깊은 문장이 없어요.' };
  }
  if (/가장좋|제일좋|최고|별점높|인생책|추천/.test(q)) {
    const top = [...done].filter((b) => Number(b.rating)).sort((a, b) => Number(b.rating) - Number(a.rating) || String(b.end || '').localeCompare(String(a.end || '')));
    return { text: top.length ? `별점이 가장 높은 책이에요.\n${titles(top, 3)}` : '아직 별점을 준 책이 없어요.' };
  }
  if (/마지막|최근|방금|요즘/.test(q) && done.length) return { text: `가장 최근에 다 읽은 책이에요.\n${bookCard(done[0])}` };
  // 몇 권 읽었는지 (기본: 올해)
  const yr = yearAsked || y;
  const n = booksReadIn(books, yr);
  const inYear = done.filter((b) => String(b.end || '').startsWith(`${yr}-`));
  const lines = [`${yr === y ? `올해(${y}년)` : `${yr}년`} 다 읽은 책은 ${n}권이에요.`];
  if (yr === y) lines.push(`· 작년 ${booksReadIn(books, y - 1)}권 · 지금까지 모두 ${done.length}권`);
  const goal = (ctx.data.goals || []).find((g) => g.kind === 'books');
  if (goal && yr === y) { const p = goalProgress(goal, { data: ctx.data, today: ctx.now, books }); lines.push(`· 목표 ${p.target}권 중 ${p.current}권${p.sub ? ` (${p.sub})` : ''}`); }
  if (inYear.length) lines.push(titles(inYear));
  if (reading.length && yr === y) lines.push(`· 지금 읽는 책: ${reading.map((b) => b.title).join(', ')}`);
  return { text: lines.join('\n'), chips: [ask1('지금 읽는 책 뭐야?'), ask1('인상 깊은 문장 보여줘')] };
}

// ───── 일기 ─────
const PARTS = [['happy', '행복했던 일'], ['moved', '인상 깊었던 일'], ['thanks', '감사했던 일']];
const has = (e) => !!e && (PARTS.some(([k]) => String(e[k] || '').trim()) || !!e.worry);
function diaryAnswer(ctx) {
  const log = ctx.data.diaryLog || {};
  const q = ctx.q;
  // 고민거리: 비서도 볼 수 없어요
  if (/고민거리/.test(q)) {
    const n = Object.values(log).filter((e) => e?.worry).length;
    return { text: `고민거리는 덕준님 비밀번호로 잠겨 있어서 비서도 볼 수 없어요.${n ? ` (고민거리를 쓴 날은 ${n}번이에요)` : ''}\n보려면 기록 → 일기에서 🔒 고민거리를 눌러 비밀번호를 넣어 주세요.` };
  }
  const today = key(ctx.now);
  // 하루를 콕 집어 물으면: 그날 일기 (고민거리는 빼고)
  if (ctx.time?.kind === 'day' || /오늘|어제|그저께|그제/.test(q)) {
    const dayKey = /그저께|그제/.test(q) ? key(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() - 2)) : /어제/.test(q) ? key(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() - 1)) : period(ctx).start;
    const e = log[dayKey];
    const label = dayKey === today ? '오늘' : mdw(dayKey);
    if (!has(e)) return { text: `${label}은 아직 일기를 안 썼어요.${dayKey === today ? ' 한 줄이라도 남겨 볼까요?' : ''}` };
    const lines = [`${label} 일기예요.`, ...PARTS.filter(([k]) => String(e[k] || '').trim()).map(([k, l]) => `· ${l}: ${String(e[k]).trim()}`)];
    if (e.worry) lines.push('· 고민거리: 🔒 잠겨 있어요');
    return { text: lines.join('\n') };
  }
  // 몇 번 썼는지 (기본: 이번 달)
  const p = period(ctx, 'month');
  const days = Object.keys(log).filter((k) => k >= p.start && k <= p.end && has(log[k])).sort();
  const total = Object.keys(log).filter((k) => has(log[k])).length;
  // 오늘부터 거꾸로 며칠 이어서 썼는지
  let streak = 0;
  for (let d = new Date(ctx.now); has(log[key(d)]) || (streak === 0 && key(d) === today); d.setDate(d.getDate() - 1)) { if (has(log[key(d)])) streak++; else if (key(d) !== today) break; if (streak > 3650) break; }
  const lines = [`${p.label} 일기는 ${days.length}번 썼어요.${has(log[today]) ? ' 오늘 일기도 썼어요.' : ' 오늘 일기는 아직이에요.'}`];
  if (streak >= 2) lines.push(`· ${streak}일째 이어서 쓰고 있어요. 멋져요!`);
  lines.push(`· 지금까지 모두 ${total}편`);
  return { text: lines.join('\n'), chips: [ask1('어제 일기 보여줘')] };
}
