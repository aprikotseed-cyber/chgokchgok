// 앱 안 비서: 덕준님이 입력한 데이터만 보고 답해요. 인터넷이나 AI를 쓰지 않아요.
// 질문에서 ① 무엇을 묻는지 ② 어떤 항목인지(직접 등록한 이름) ③ 언제인지 를 뽑아서 답을 만들고,
// 애매하면 되묻고, 모르면 모른다고 말해요.
import { currentTotals, currentPayment, loanBalance, stockDetail, stockMarket, homeValue } from './projection.js?v=20261111k';
import { upcoming, fixedSummary, nextDue, daysBetween, dateOnly } from './reminders.js?v=20261111k';
import { scheduleRecords, yearlySummary } from './records.js?v=20261111k';
import { nextScheduled, scheduleBalanceAt, paidRows, ymd } from './schedule.js?v=20261111k';
import { won, wonExact, mdw, pct } from './format.js?v=20261111k';
import { eventsOn, groupTasks, dueLabel, fromKey, parseQuickEvent, parseQuickTask, classifyEvent, eventLine, repeatLabel, parseEventInput } from './agenda.js?v=20261111k';

// ───── 글자 다루기 ─────
export const norm = (s) => String(s || '').toLowerCase().replace(/[\s·.,!?~'"()\-_/]+/g, '');

/** 두 문자열에서 연속으로 같은 가장 긴 부분의 길이 */
function lcs(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

/** 받침에 따라 조사 고르기: josa('관리비', '은', '는') → '는' */
export function josa(word, withFinal, withoutFinal) {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  let has;
  if (code >= 0 && code <= 11171) has = code % 28 !== 0;
  else if (/\d/.test(ch)) has = '0136780'.includes(ch) || ch === '0';
  else has = /[lmnr]/i.test(ch); // 영어: 대략적으로
  return has ? withFinal : withoutFinal;
}
const 은 = (w) => `${w}${josa(w, '은', '는')}`;
const 이에요 = (w) => `${w}${josa(w, '이에요', '예요')}`;

/** 이름이 질문에 들어 있는지 점수 (0이면 아님). 띄어쓰기·일부만 쓰기·작은 오타를 허용 */
function nameScore(q, name) {
  const n = norm(name);
  if (!n) return 0;
  if (q.includes(n)) return n.length + 2;
  if (n.length <= 2) return 0;
  const l = lcs(q, n);
  if (l >= 3) return l;
  // 앞부분만 줄여 말해도 (넷플 → 넷플릭스)
  return /[가-힣]/.test(n) && q.includes(n.slice(0, 2)) ? 2 : 0;
}

// ───── ③ 언제 ─────
export function parseTime(q, now) {
  const t = dateOnly(now);
  const y = t.getFullYear();
  const m = t.getMonth();
  const day = (d) => ({ kind: 'day', start: d, end: d });
  const month = (yy, mm) => ({ kind: 'month', start: new Date(yy, mm, 1), end: new Date(yy, mm + 1, 0), label: `${yy === y ? '' : `${yy}년 `}${((mm % 12) + 12) % 12 + 1}월` });
  const year = (yy) => ({ kind: 'year', year: yy, start: new Date(yy, 0, 1), end: new Date(yy, 11, 31), label: `${yy}년` });
  if (q.includes('오늘')) return { ...day(t), label: '오늘' };
  if (q.includes('내일')) return { ...day(new Date(y, m, t.getDate() + 1)), label: '내일' };
  if (q.includes('모레')) return { ...day(new Date(y, m, t.getDate() + 2)), label: '모레' };
  const dow = (t.getDay() + 6) % 7; // 월요일 0
  const WD = '월화수목금토일';
  const md = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
  // 'X요일' (요일만 말하면 이번 주), '다음 주 X요일'
  const wd = q.match(/(다음주|담주)?(이번주|금주)?([월화수목금토일])요일/);
  if (wd) {
    const d = new Date(y, m, t.getDate() - dow + (wd[1] ? 7 : 0) + WD.indexOf(wd[3]));
    return { ...day(d), label: md(d) };
  }
  if (q.includes('주말')) {
    const next = /다음주|담주/.test(q) ? 7 : 0;
    const sat = new Date(y, m, t.getDate() - dow + 5 + next);
    return { kind: 'range', start: sat < t ? t : sat, end: new Date(y, m, t.getDate() - dow + 6 + next), label: next ? '다음 주말' : '이번 주말' };
  }
  const mdm = q.match(/(\d{1,2})월(\d{1,2})일/);
  if (mdm && Number(mdm[1]) <= 12) {
    let d = new Date(y, Number(mdm[1]) - 1, Number(mdm[2]));
    if (d < new Date(y, m, t.getDate() - 30)) d = new Date(y + 1, d.getMonth(), d.getDate());
    return { ...day(d), label: md(d) };
  }
  if (/이번주|금주/.test(q)) return { kind: 'range', start: t, end: new Date(y, m, t.getDate() + 6 - dow), label: '이번 주' };
  if (/다음주|담주/.test(q)) return { kind: 'range', start: new Date(y, m, t.getDate() + 7 - dow), end: new Date(y, m, t.getDate() + 13 - dow), label: '다음 주' };
  if (/다음달|담달|내달/.test(q)) return month(y, m + 1);
  if (/지난달|저번달|전달/.test(q)) return month(y, m - 1);
  if (/이번달|이달|금월/.test(q)) return month(y, m);
  const ym = q.match(/(20\d\d)년(\d{1,2})월/);
  if (ym) return month(Number(ym[1]), Number(ym[2]) - 1);
  const yy = q.match(/(20\d\d)년/);
  if (yy) return year(Number(yy[1]));
  if (/작년|지난해|전년/.test(q)) return year(y - 1);
  if (/내년/.test(q)) return year(y + 1);
  if (/올해|금년|올한해/.test(q)) return year(y);
  const mm = q.match(/(\d{1,2})월/);
  if (mm && Number(mm[1]) >= 1 && Number(mm[1]) <= 12) {
    const k = Number(mm[1]) - 1;
    return { ...month(y, k), loose: true }; // 지난 달이면 문맥에 따라 내년으로
  }
  return null;
}

// ───── ② 어떤 항목 ─────
const KIND_ALIAS = { 주택담보대출: ['주담대', '주택담보', '담보대출', '집대출'], 신용대출: ['신용대출', '마통', '마이너스통장'], 교직원공제회: ['공제회', '교직원공제회'] };

function findEntities(q, data, agenda) {
  const out = [];
  const add = (type, item, name, score) => score && out.push({ type, item, name, score });
  for (const s of data.savings || []) add('saving', s, s.name, Math.max(nameScore(q, s.name), s.kind && norm(s.kind).length >= 2 && q.includes(norm(s.kind)) ? 2 : 0));
  for (const s of data.stocks || []) add('stock', s, s.name, Math.max(nameScore(q, s.name), s.ticker && q.includes(norm(s.ticker)) && norm(s.ticker).length >= 2 ? 10 : 0));
  for (const h of data.homes || []) add('home', h, h.name, Math.max(nameScore(q, h.name), nameScore(q, h.aptName)));
  for (const l of data.debts || []) {
    const alias = (KIND_ALIAS[l.kind] || []).some((a) => q.includes(norm(a))) ? 3 : 0;
    add('loan', l, l.name, Math.max(nameScore(q, l.name), alias));
  }
  for (const f of data.fixed || []) add('fixed', f, f.name, nameScore(q, f.name));
  const cats = [...new Set((data.fixed || []).map((f) => f.category).filter(Boolean))];
  for (const c of cats) if (q.includes(norm(c))) out.push({ type: 'category', name: c, score: c.length + 1 });
  if (/국내주식|국내/.test(q)) out.push({ type: 'market', key: 'kr', name: '국내주식', score: 3 });
  if (/해외주식|해외|미국주식|미장/.test(q)) out.push({ type: 'market', key: 'us', name: '해외주식', score: 3 });
  if (/연금저축|연금계좌/.test(q)) out.push({ type: 'market', key: 'pension', name: '연금저축', score: 4 });
  if (agenda) {
    // 캘린더 종류 (운동 → Exercise …), 반려자 캘린더
    const calNames = [...new Set(agenda.events.map((e) => e.calName))];
    for (const [cal, words] of Object.entries(CAL_ALIAS)) {
      const name = calNames.find((n) => norm(n) === cal);
      if (name && (q.includes(cal) || words.some((w) => q.includes(w)))) out.push({ type: 'cal', name, score: 3 });
    }
    if (PARTNER_WORDS.some((w) => q.includes(w))) out.push({ type: 'partner', name: '반려자', score: 3 });
    // 일정·할일 제목 (점수는 4까지만: 등록한 자산 이름보다 앞서지 않게)
    const seen = new Set();
    for (const e of agenda.events) {
      if (seen.has(e.title)) continue;
      seen.add(e.title);
      const sc = nameScore(q, e.title);
      if (sc >= 3) out.push({ type: 'event', item: e, name: e.title, score: Math.min(sc, 4) });
    }
    for (const t of agenda.tasks) {
      const sc = nameScore(q, t.title);
      if (sc >= 3) out.push({ type: 'task', item: t, name: t.title, score: Math.min(sc, 4) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const CAL_ALIAS = {
  exercise: ['운동', '헬스', '러닝', '달리기', '필라테스', '수영', '요가'],
  cherish: ['데이트'],
  birthday: ['생일', '생신'],
  work: ['업무', '회의', '출장', '연수', '학교일정', '회사'],
  life: ['개인일정'],
};
const PARTNER_WORDS = ['반려자', '와이프', '아내', '남편', '배우자', '짝꿍', '내캘린더', '애인', '여자친구', '남자친구', '여친', '남친'];

// ───── ① 무엇을 ─────
const INTENTS = [
  { id: 'brief', words: ['브리핑', '하루요약', '오늘요약', '오늘어때', '오늘하루', '하루일과'] },
  { id: 'schedule', words: ['일정', '약속', '스케줄', '캘린더', '달력', '뭐있', '뭐해', '계획', '바빠', '바쁘', '한가', '시간있', '시간돼', '몇시'], types: ['event', 'cal', 'partner'] },
  { id: 'tasks', words: ['할일', '할거', '해야할', '해야돼', '해야되', '해야하', '투두', 'todo', '마감', '밀린', '못한', '안한', '끝낸', '완료한'], types: ['task'] },
  { id: 'net', words: ['총자산', '순자산', '재산', '내자산', '자산얼마', '자산이얼마', '전재산', '지난달대비', '얼마늘', '얼마줄'] },
  { id: 'saved', words: ['저축액', '저축얼마', '모은돈', '예금', '적금', '통장', '파킹'], types: ['saving'] },
  { id: 'home', words: ['주택', '아파트', '집값', '시세', '실거래', '부동산', '우리집'], types: ['home'] },
  { id: 'debtBal', words: ['남은원금', '잔액', '남은대출', '대출잔액', '빚', '대출얼마', '얼마남', '남았'], types: ['loan'] },
  { id: 'nextPay', words: ['다음상환', '상환일', '납부일', '상환액', '원리금', '얼마나가', '언제나가', '언제빠져', '얼마빠져', '내야', '낼돈', '상환', '납부', '언제야'], types: ['loan'] },
  { id: 'count', words: ['회차', '몇번', '몇회'], types: ['loan'] },
  { id: 'interest', words: ['이자', '낸이자', '이자얼마'], types: ['loan'] },
  { id: 'principalPaid', words: ['갚은', '상환한', '갚았', '낸원금', '갚은원금'], types: ['loan'] },
  { id: 'payoff', words: ['다갚', '완납', '언제끝', '만기', '상환끝', '다끝', '언제까지'], types: ['loan'] },
  { id: 'fixedTotal', words: ['고정지출', '고정비', '매달나가', '월지출', '정기지출', '구독료', '요금'], types: ['fixed', 'category'] },
  { id: 'remaining', words: ['남은출금', '남은지출', '앞으로나갈', '더나갈', '이번달남은', '남은돈', '남은거'] },
  { id: 'upcoming', words: ['돈나갈', '나갈돈', '빠져나갈', '나가는거', '나갈거', '뭐나가', '출금', '결제'] },
  { id: 'stocks', words: ['주식', '평가', '수익', '수익률', '손익', '종목', 'etf', '얼마벌', '벌었'], types: ['stock', 'market'] },
  { id: 'fx', words: ['환율', '달러', '환차', '환율효과', '원달러'] },
  { id: 'savingRec', words: ['저축한', '저축기록', '넣은돈', '저축했', '모았'] },
  { id: 'help', words: ['도움', '뭘물어', '뭐물어', '할수있', '사용법', '도와', '뭐해줄', '기능'] },
  { id: 'hello', words: ['안녕', '고마워', '고맙', '하이', '수고', '감사'] },
];

/** 질문 하나에 대한 답. { text, chips: [{label, q}], unknown } */
export function ask(question, data, market = {}, now = new Date(), agenda = null, memos = []) {
  const q = norm(question);
  if (!q) return { text: '궁금한 걸 적어 주세요.', chips: SUGGEST };
  const ctx = { q, raw: question, data, market, agenda, now: dateOnly(now), time: parseTime(q, now), ents: findEntities(q, data, agenda) };

  // '와이파이 비번 바뀜 메모해줘', '메모: …': 메모 남기기 (바로 저장) / '와이파이 메모 찾아줘': 메모 찾기
  if (MEMO_SAVE.test(q) || /^메모\s*[:：]/.test(question.trim())) return memoSave(question);
  if (q.includes('메모')) return memoFind(q, memos);
  // '목요일 면담을 수요일 2시로 옮겨줘', '면담 일정 지워줘': 일정 옮기기·지우기 (확인 카드로)
  if (agenda && (MOVE_RE.test(q) || DEL_RE.test(q)) && !ctx.ents.some((e) => ['loan', 'fixed', 'saving', 'stock', 'home'].includes(e.type) && e.score >= 5)) {
    const r = changeAnswer(ctx, now);
    if (r) return r;
  }
  // '내일 3시 상담 넣어줘', '우유 사기 할일 추가해줘': 일정·할일 넣기 (확인 카드로)
  if (ADD_RE.test(q) && !ctx.ents.some((e) => ['loan', 'fixed', 'saving', 'stock', 'home'].includes(e.type) && e.score >= 5)) return addAnswer(ctx, now);

  // '가장 빠른 / 제일 먼저 / 다음에' 빠져나가는 것: 순서를 묻는 질문은 합계보다 먼저 봐요
  if (asksNext(q) && !ctx.ents.some((e) => e.type === 'loan' || e.type === 'fixed')) return H.nextOut(ctx);

  const scored = INTENTS.map((it) => {
    let score = it.words.reduce((a, w) => a + (q.includes(w) ? w.length : 0), 0);
    if (score && it.types && ctx.ents.some((e) => it.types.includes(e.type))) score += 2;
    return { it, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  // 시간만 있고 묻는 게 없으면: 일정을 연결했으면 그날 일정(나갈 돈 포함), 아니면 나갈 돈
  if (!scored.length && ctx.time && !ctx.ents.length) return agenda ? H.schedule(ctx) : H.upcoming(ctx);
  // 묻는 말 없이 항목 이름만 있으면 그 항목 요약
  if (!scored.length && ctx.ents.length) return entitySummary(ctx, ctx.ents[0]);
  if (!scored.length) return { text: '그건 아직 잘 모르겠어요. 아래처럼 물어보시면 바로 알려드릴게요.', chips: SUGGEST, unknown: true };

  // 대출 이름이 없는데 다른 항목(고정지출·계좌 등) 이름이 있으면, 대출용 질문보다 그 항목 답이 맞아요
  const LOAN_INTENTS = ['nextPay', 'debtBal', 'count', 'payoff', 'interest', 'principalPaid'];
  const top = scored[0];
  const e0 = ctx.ents[0];
  // 등록한 이름을 또렷하게 말했는데(예: '아파트 관리비') 질문 종류가 다른 항목용이면 그 이름이 우선
  if (e0 && e0.score >= 5 && top.it.types && !top.it.types.includes(e0.type)) return entitySummary(ctx, e0);
  // '어머니 생신 언제야'처럼 일정·할일 제목을 말하며 '언제'를 물으면 그 일정
  if (!['schedule', 'tasks', 'brief'].includes(top.it.id) && e0 && ['event', 'task'].includes(e0.type) && !ctx.ents.some((e) => ['loan', 'fixed', 'saving', 'stock', 'home'].includes(e.type))) return entitySummary(ctx, e0);
  // '넷플 언제 결제돼'처럼 항목을 콕 집어 물으면 전체 일정보다 그 항목 답이 먼저
  if (['upcoming', 'remaining'].includes(top.it.id) && !ctx.time && e0 && ['fixed', 'loan', 'category'].includes(e0.type)) return entitySummary(ctx, e0);
  if (LOAN_INTENTS.includes(top.it.id) && e0 && !ctx.ents.some((e) => e.type === 'loan') && !/대출|상환|이자|원금/.test(q)) return entitySummary(ctx, e0);
  return H[top.it.id](ctx);
}

export const SUGGEST = [
  { label: '오늘 일정', q: '오늘 일정 뭐야?' },
  { label: '이번 주 할일', q: '이번 주 할일 뭐야?' },
  { label: '이번 달 남은 출금', q: '이번 달 남은 출금 얼마야?' },
  { label: '다음 대출 상환', q: '다음 대출 상환 언제야?' },
  { label: '총자산', q: '총자산 얼마야?' },
  { label: '고정지출 합계', q: '고정지출 얼마야?' },
  { label: '다음에 빠져나갈 돈', q: '가장 먼저 빠져나가는 고정지출 뭐야?' },
  { label: '해외주식 수익', q: '해외주식 수익 얼마야?' },
  { label: '올해 낸 이자', q: '올해 낸 이자 얼마야?' },
];

/** 가장 빠른·제일 먼저·바로 다음 … 빠져나가는/나가는/출금되는 것을 묻는지 */
export function asksNext(q) {
  const soon = /(가장|제일|젤|젤루)(빠른|빨리|먼저|가까운|임박)|다음(에|으로)?(빠져|나가|출금|결제|지출|고정지출|고정비)|곧(빠져|나가|출금|결제)|임박한|코앞/.test(q);
  const out = /빠져|나가|출금|결제|지출|고정|내야|낼/.test(q);
  return soon && out;
}

// ───── 답 만들기 ─────
const loansOf = (ctx) => {
  const picked = ctx.ents.filter((e) => e.type === 'loan');
  const top = picked.length ? picked.filter((e) => e.score === picked[0].score).map((e) => e.item) : null;
  return { list: top || (ctx.data.debts || []), picked: !!top };
};
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dd = (n) => (n === 0 ? '오늘' : n === 1 ? '내일' : `${n}일 뒤`);
const ask1 = (label) => ({ label, q: label });
const allRecords = (ctx) => [...(ctx.data.records || []), ...scheduleRecords(ctx.data, ymd(ctx.now))];

/** 대출 한 건이 기간 안에 내는 회차들 */
function loanPaymentsIn(l, start, end, now) {
  if (l.schedule?.length) return l.schedule.filter((r) => r.date >= ymd(start) && r.date <= ymd(end)).map((r) => ({ date: toDate(r.date), amount: r.payment, principal: r.principal, interest: r.interest, n: r.n }));
  if (!l.payDay || loanBalance(l, now) <= 0) return [];
  const out = [];
  for (let d = nextDue(l.payDay, start); d && d <= end; d = nextDue(l.payDay, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))) out.push({ date: d, amount: currentPayment(l, now), approx: true });
  return out;
}

function fixedIn(data, start, end) {
  const out = [];
  for (const f of data.fixed || []) {
    if (f.active === false) continue;
    for (let d = nextDue(f.day, start); d && d <= end; d = nextDue(f.day, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))) out.push({ name: f.name, date: d, amount: Number(f.amount) || 0 });
  }
  return out;
}

/** 'N일 후 11월 19일(목)' */
function whenText(now, d) {
  const n = daysBetween(now, d);
  const head = n === 0 ? '오늘' : n === 1 ? '내일' : `${n}일 후`;
  return `${head} ${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]})`;
}

/** '초등교사노동조합'으로 / '휴대폰'으로 / '음악'로 (받침 ㄹ이거나 없으면 '로') */
function euro(name) {
  const code = String(name).trim().slice(-1).charCodeAt(0) - 0xac00;
  const jong = code >= 0 && code <= 11171 ? code % 28 : 0;
  return `'${name}'${jong && jong !== 8 ? '으로' : '로'}`;
}

const H = {
  schedule: (ctx) => scheduleAnswer(ctx),
  tasks: (ctx) => tasksAnswer(ctx),
  brief(ctx) {
    const c = { ...ctx, time: { kind: 'day', start: ctx.now, end: ctx.now, label: '오늘' } };
    return { text: `${scheduleAnswer(c).text}\n\n${tasksAnswer(c).text}` };
  },
  /** 가장 빨리 빠져나가는 고정지출(질문에 대출·상환이 없으면 고정지출만, '나갈 돈'처럼 넓게 물으면 대출 포함) */
  nextOut(ctx) {
    const onlyFixed = /고정|구독|요금|공과금|관리비/.test(ctx.q) || !/대출|상환|돈|모든|전체|아무/.test(ctx.q);
    const list = upcoming(onlyFixed ? { fixed: ctx.data.fixed } : ctx.data, ctx.now, 62);
    if (!list.length) return { text: onlyFixed ? '앞으로 두 달 안에 빠져나갈 고정지출이 없어요. 고정지출 탭에서 출금일을 확인해 주세요.' : '앞으로 두 달 안에 빠져나갈 돈이 없어요.' };
    const first = list.filter((u) => u.dday === list[0].dday);
    const d = first[0].date;
    const acct = (u) => (u.account ? ` (${u.account})` : '');
    const kind = (u) => (u.type === 'loan' ? '상환' : '지출');
    let text;
    if (first.length === 1) {
      const u = first[0];
      text = `${whenText(ctx.now, d)} ${euro(u.name)} ${wonExact(u.amount)} ${kind(u)} 예정이에요.${acct(u)}`;
    } else {
      text = `${whenText(ctx.now, d)}에 ${first.length}건이 빠져나갈 예정이에요. 모두 ${wonExact(first.reduce((a, u) => a + u.amount, 0))}이에요.\n${first.map((u) => `· ${euro(u.name)} ${wonExact(u.amount)}${acct(u)}`).join('\n')}`;
    }
    const after = list.find((u) => u.dday > first[0].dday);
    if (after) text += `\n그다음은 ${whenText(ctx.now, after.date)} ${euro(after.name)} ${wonExact(after.amount)}이에요.`;
    return { text, chips: [ask1('이번 달 남은 출금 얼마야?')] };
  },

  hello: () => ({ text: '네, 덕준님. 일정·할일·메모부터 자산·대출까지 편하게 말씀해 주세요.' }),

  help: () => ({
    text: '입력해 두신 내용으로 이런 걸 알려드릴 수 있어요.\n· 일정: 오늘·내일·요일·이번 주 일정, 일정이 언제인지\n· 일정·할일 넣기: ‘금요일 7시 헬스 넣어줘’, ‘우유 사기 할일 추가해줘’\n· 할일: 오늘·이번 주·밀린 할일\n· 총자산, 저축액, 주택 시세\n· 대출: 다음 상환일과 금액, 남은 원금, 회차, 낸 이자, 다 갚는 날\n· 고정지출: 합계, 가장 먼저 빠져나가는 것, 항목별 출금일, 분류별 합계\n· 이번 달·이번 주·내일 나갈 돈\n· 주식: 묶음별·종목별 수익, 환율과 환율 효과\n· 연도별 저축·상환 기록',
    chips: SUGGEST,
  }),

  net(ctx) {
    const t = currentTotals(ctx.data, ctx.market, ctx.now);
    const ym = ymd(ctx.now).slice(0, 7);
    const snaps = ctx.data.snapshots || {};
    const prev = Object.keys(snaps).filter((k) => k < ym).sort().pop();
    const diff = prev ? t.net - snaps[prev].net : null;
    return {
      text: `총자산은 ${won(t.net)}이에요.\n저축액 ${won(t.savings + t.stocks)} + 주택 ${won(t.homes)} − 대출잔액 ${won(t.debts)}${diff != null ? `\n${Number(prev.slice(5))}월 기록보다 ${diff >= 0 ? `${won(diff)} 늘었어요` : `${won(-diff)} 줄었어요`}.` : ''}`,
      chips: [ask1('저축액 얼마야?'), ask1('대출 잔액 얼마야?')],
    };
  },

  saved(ctx) {
    const es = ctx.ents.filter((x) => x.type === 'saving');
    const top = es.filter((x) => x.score === es[0]?.score);
    if (top.length) {
      const line = (s) => `${s.name} 잔액은 ${won(s.balance)}이에요.${s.monthly ? ` 매달 ${won(s.monthly)}씩 넣고 있어요.` : ''}${s.rate ? ` (연 ${pct(s.rate)})` : ''}`;
      return { text: top.map((x) => line(x.item)).join('\n') };
    }
    const t = currentTotals(ctx.data, ctx.market, ctx.now);
    const lines = (ctx.data.savings || []).map((s) => `· ${s.name} ${won(s.balance)}`);
    return { text: `저축액은 ${won(t.savings + t.stocks)}이에요.${t.stocks ? ` (저축·현금 ${won(t.savings)} + 주식 ${won(t.stocks)})` : ''}${lines.length ? `\n${lines.join('\n')}` : ''}` };
  },

  home(ctx) {
    const homes = ctx.data.homes || [];
    if (!homes.length) return { text: '등록된 주택이 없어요. 자산 탭에서 추가하면 실거래가로 시세를 알려드릴게요.' };
    const e = ctx.ents.find((x) => x.type === 'home');
    const list = e ? [e.item] : homes;
    return {
      text: list.map((h) => {
        const mh = ctx.market.homes?.[h.id];
        const last = mh?.trades?.[0];
        const v = homeValue(h, ctx.market);
        const bought = (Number(h.purchasePrice) || 0) * ((h.share ?? 100) / 100);
        const gain = bought ? `\n구매가 ${won(bought)} 대비 ${v >= bought ? '+' : '−'}${won(Math.abs(v - bought))} (${v >= bought ? '+' : ''}${pct(((v - bought) / bought) * 100, 2)})` : '';
        return `${h.name} 시세는 ${won(v)}이에요.${mh?.basis && h.useAuto !== false ? ` (${mh.basis})` : ''}${gain}${last ? `\n가장 최근 실거래: ${last.date} ${won(last.price)}${last.floor ? ` · ${last.floor}층` : ''}` : ''}`;
      }).join('\n\n'),
    };
  },

  debtBal(ctx) {
    const { list, picked } = loansOf(ctx);
    if (!list.length) return { text: '등록된 대출이 없어요.' };
    const at = ctx.time && ctx.time.kind !== 'day' && ctx.time.end > ctx.now ? ctx.time.end : ctx.now;
    const bal = (l) => (l.schedule?.length ? scheduleBalanceAt(l.schedule, ymd(at)) : loanBalance(l, ctx.now));
    const when = at === ctx.now ? '지금' : `${ctx.time.label} 말`;
    if (list.length === 1) return { text: `${list[0].name}의 ${when} 남은 원금은 ${wonExact(bal(list[0]))}이에요.` };
    const total = list.reduce((a, l) => a + bal(l), 0);
    return { text: `${when} 대출잔액은 모두 ${won(total)}이에요.\n${list.map((l) => `· ${l.name} ${wonExact(bal(l))}`).join('\n')}`, chips: picked ? [] : list.map((l) => ask1(`${l.name} 다음 상환 언제야?`)) };
  },

  nextPay(ctx) {
    const { list } = loansOf(ctx);
    if (!list.length) return { text: '등록된 대출이 없어요.' };
    let start = ctx.now;
    let end = null;
    if (ctx.time?.kind === 'month' || ctx.time?.kind === 'year' || ctx.time?.kind === 'range' || ctx.time?.kind === 'day') {
      ({ start, end } = ctx.time);
      if (ctx.time.loose && end < ctx.now) { start = new Date(start.getFullYear() + 1, start.getMonth(), 1); end = new Date(end.getFullYear() + 1, end.getMonth() + 1, 0); }
    }
    const lines = [];
    for (const l of list) {
      if (end) {
        const ps = loanPaymentsIn(l, start, end, ctx.now);
        if (!ps.length) { lines.push(`${l.name}: ${ctx.time.label}에는 상환이 없어요${!l.schedule?.length && !l.payDay ? ' (상환일 미입력)' : ''}.`); continue; }
        for (const p of ps) lines.push(`${l.name}: ${mdw(p.date)} ${p.approx ? '약 ' : ''}${wonExact(p.amount)}${p.principal != null ? ` (원금 ${wonExact(p.principal)} · 이자 ${wonExact(p.interest)})` : ''}`);
        continue;
      }
      if (l.schedule?.length) {
        const r = nextScheduled(l.schedule, ymd(ctx.now));
        if (!r) { lines.push({ at: Infinity, text: `${l.name}: 모두 갚았어요.` }); continue; }
        const d = toDate(r.date);
        lines.push({ at: d, text: `${l.name}: ${mdw(d)} (${dd(daysBetween(ctx.now, d))}) ${wonExact(r.payment)} · ${r.n}회차${l.account ? ` · ${l.account}` : ''}\n  원금 ${wonExact(r.principal)} · 이자 ${wonExact(r.interest)}` });
      } else if (l.payDay) {
        const d = nextDue(l.payDay, ctx.now);
        lines.push({ at: d, text: `${l.name}: ${mdw(d)} (${dd(daysBetween(ctx.now, d))}) ${wonExact(currentPayment(l, ctx.now))}${l.account ? ` · ${l.account}` : ''}` });
      } else lines.push({ at: Infinity, text: `${l.name}: 이번 달 약 ${wonExact(currentPayment(l, ctx.now))} (상환일을 넣으면 날짜도 알려드려요)` });
    }
    // 가까운 날짜부터
    const out = lines.map((x) => (typeof x === 'string' ? { at: 0, text: x } : x)).sort((a, b) => a.at - b.at).map((x) => x.text);
    const sum = end ? list.flatMap((l) => loanPaymentsIn(l, start, end, ctx.now)).reduce((a, p) => a + p.amount, 0) : 0;
    return { text: `${end && list.length > 1 && sum ? `${ctx.time.label} 대출 상환은 모두 ${wonExact(sum)}이에요.\n` : ''}${out.join('\n')}` };
  },

  count(ctx) {
    const { list } = loansOf(ctx);
    const withSch = list.filter((l) => l.schedule?.length);
    if (!withSch.length) return { text: '회차는 상환스케줄을 불러온 대출만 알 수 있어요. 부채 탭에서 대출을 열고 상환스케줄 파일을 불러와 주세요.' };
    return { text: withSch.map((l) => { const paid = paidRows(l.schedule, ymd(ctx.now)).length; return `${l.name}: ${l.schedule.length}회 중 ${paid}회 냈어요. ${l.schedule.length - paid}회 남았어요.`; }).join('\n') };
  },

  interest(ctx) {
    // '다음/이번 달 이자'처럼 앞으로 낼 이자를 물으면 상환 답으로
    if (/다음|이번달|낼|내야/.test(ctx.q) && !/낸이자|냈/.test(ctx.q)) return H.nextPay(ctx);
    return paidSummary(ctx, 'interest');
  },

  principalPaid: (ctx) => paidSummary(ctx, 'principal'),

  payoff(ctx) {
    const { list } = loansOf(ctx);
    if (!list.length) return { text: '등록된 대출이 없어요.' };
    return {
      text: list.map((l) => {
        if (l.schedule?.length) {
          const last = l.schedule.at(-1);
          const left = l.schedule.length - paidRows(l.schedule, ymd(ctx.now)).length;
          return `${l.name}: ${mdw(toDate(last.date))}에 마지막 ${last.n}회차를 내면 다 갚아요. (${left}회 남음)`;
        }
        return l.maturity ? `${l.name}: 만기는 ${l.maturity.slice(0, 4)}년 ${Number(l.maturity.slice(5))}월이에요.` : `${l.name}: 만기가 입력되지 않았어요.`;
      }).join('\n'),
    };
  },

  fixedTotal(ctx) {
    const fixed = ctx.data.fixed || [];
    if (!fixed.length) return { text: '등록된 고정지출이 없어요. 고정지출 탭에서 추가해 주세요.' };
    const cat = ctx.ents.find((e) => e.type === 'category');
    const item = ctx.ents.find((e) => e.type === 'fixed');
    if (item && (!cat || item.score >= cat.score)) return entitySummary(ctx, item);
    if (cat) {
      const fs = fixed.filter((f) => f.category === cat.name && f.active !== false);
      return { text: `${cat.name} 고정지출은 매달 ${wonExact(fs.reduce((a, f) => a + (Number(f.amount) || 0), 0))}이에요.\n${fs.map((f) => `· ${f.name} ${wonExact(f.amount)} (매달 ${f.day}일)`).join('\n')}` };
    }
    const s = fixedSummary(fixed, ctx.now);
    return {
      text: `매달 고정지출은 ${wonExact(s.total)}이에요. (${s.count}건)\n${s.categories.map((c) => `· ${c.name} ${wonExact(c.amount)}`).join('\n')}`,
      chips: [ask1('이번 달 남은 출금 얼마야?')],
    };
  },

  remaining(ctx) {
    const end = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, 0);
    return outflow(ctx, ctx.now, end, `${ctx.now.getMonth() + 1}월에 남은 출금`);
  },

  upcoming(ctx) {
    if (ctx.time) {
      let { start, end } = ctx.time;
      if (start < ctx.now && end >= ctx.now) start = ctx.now;
      if (ctx.time.loose && end < ctx.now) { start = new Date(start.getFullYear() + 1, start.getMonth(), 1); end = new Date(end.getFullYear() + 1, end.getMonth() + 1, 0); }
      return outflow(ctx, start, end, `${ctx.time.label} 나갈 돈`);
    }
    return outflow(ctx, ctx.now, new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + 13), '앞으로 2주 동안 나갈 돈');
  },

  stocks(ctx) {
    const st = ctx.ents.find((e) => e.type === 'stock');
    if (st) return entitySummary(ctx, st);
    const mk = ctx.ents.find((e) => e.type === 'market');
    const all = ctx.data.stocks || [];
    if (!all.length) return { text: '등록된 주식이 없어요. 자산 탭에서 종목을 추가해 주세요.' };
    const groups = mk ? [[mk.key, mk.name]] : [['kr', '국내주식'], ['us', '해외주식'], ['pension', '연금저축']];
    const lines = [];
    let total = 0;
    for (const [k, name] of groups) {
      const ds = all.filter((s) => stockMarket(s) === k).map((s) => stockDetail(s, ctx.market));
      if (!ds.length) { if (mk) lines.push(`${name}에 등록된 종목이 없어요.`); continue; }
      const val = ds.reduce((a, x) => a + x.valueKrw, 0);
      total += val;
      const withCost = ds.filter((x) => x.costKrw);
      const cost = withCost.reduce((a, x) => a + x.costKrw, 0);
      const profit = withCost.reduce((a, x) => a + x.profitKrw, 0);
      const fxEff = ds.reduce((a, x) => a + (x.fxEffect || 0), 0);
      lines.push(`${name}: 평가 ${won(val)}${cost ? ` · 수익 ${profit >= 0 ? '+' : '−'}${won(Math.abs(profit))} (${profit >= 0 ? '+' : ''}${pct((profit / cost) * 100)})` : ''}${k === 'us' && fxEff ? `\n  그중 환율 효과 ${fxEff >= 0 ? '+' : '−'}${won(Math.abs(fxEff))}` : ''}`);
    }
    let head = '';
    if (!mk) {
      const ds = all.filter((s) => Number(s.qty) > 0).map((s) => stockDetail(s, ctx.market)).filter((x) => x.costKrw);
      const cost = ds.reduce((a, x) => a + x.costKrw, 0);
      const profit = ds.reduce((a, x) => a + x.valueKrw - x.costKrw, 0);
      head = `주식 평가금액은 모두 ${won(total)}이에요.${cost ? ` 손익 ${profit >= 0 ? '+' : '−'}${won(Math.abs(profit))} (${profit >= 0 ? '+' : ''}${pct((profit / cost) * 100, 2)})` : ''}\n`;
    }
    return { text: `${head}${lines.join('\n')}` };
  },

  fx(ctx) {
    const usd = ctx.market.fx?.USD;
    const ds = (ctx.data.stocks || []).map((s) => stockDetail(s, ctx.market)).filter((x) => x.fxEffect != null);
    const eff = ds.reduce((a, x) => a + x.fxEffect, 0);
    const buy = ds.length ? ds.reduce((a, x) => a + x.cost * x.buyFx, 0) / ds.reduce((a, x) => a + x.cost, 0) : null;
    if (!usd) return { text: '아직 환율 정보가 없어요. 매일 아침 자동으로 받아오거나, 자산 → 해외주식의 달러 환율에서 직접 넣을 수 있어요.' };
    return { text: `지금 환율은 1달러 ${wonExact(usd)}이에요.${buy ? `\n해외주식 평균 매입 환율은 ${wonExact(buy)}이라서, 환율 효과는 ${이에요(`${eff >= 0 ? '+' : '−'}${won(Math.abs(eff))}`)}.` : ''}` };
  },

  savingRec(ctx) {
    const year = String(ctx.time?.year || ctx.time?.start?.getFullYear() || ctx.now.getFullYear());
    const recs = (ctx.data.records || []).filter((r) => r.type === 'saving');
    if (ctx.time?.kind === 'month') {
      const ym = ymd(ctx.time.start).slice(0, 7);
      const sum = recs.filter((r) => r.date.startsWith(ym)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      return { text: `${ctx.time.label}에 저축한 금액은 ${won(sum)}이에요.` };
    }
    const y = yearlySummary(recs).find((x) => x.year === year);
    return { text: `${year}년에 저축한 금액은 ${won(y?.saving || 0)}이에요.${y ? ` (기록 ${y.count}건)` : ''}` };
  },
};

/** 낸 이자·갚은 원금 합계 (기간 기본: 올해) */
function paidSummary(ctx, field) {
  const { list, picked } = loansOf(ctx);
  const ids = new Set(list.map((l) => l.id));
  let recs = allRecords(ctx).filter((r) => r.type === 'repayment' && ids.has(r.targetId));
  let label = `${ctx.now.getFullYear()}년`;
  if (ctx.time?.kind === 'year') { recs = recs.filter((r) => r.date.startsWith(`${ctx.time.year}-`)); label = ctx.time.label; }
  else if (ctx.time?.kind === 'month') { const ym = ymd(ctx.time.start).slice(0, 7); recs = recs.filter((r) => r.date.startsWith(ym)); label = ctx.time.label; }
  else if (/지금까지|전체|총|누적/.test(ctx.q)) label = '지금까지';
  else recs = recs.filter((r) => r.date.startsWith(`${ctx.now.getFullYear()}-`));
  const key = field === 'interest' ? 'interest' : 'amount';
  const sum = recs.reduce((a, r) => a + (Number(r[key]) || 0), 0);
  const what = field === 'interest' ? '낸 이자' : '갚은 원금';
  return { text: `${label} ${picked && list.length === 1 ? `${list[0].name}에 ` : ''}${what}는 ${wonExact(sum)}이에요.${recs.length ? ` (${recs.length}회)` : ''}`, chips: [ask1(`${label === '지금까지' ? '올해' : '지금까지'} ${what} 얼마야?`)] };
}

/** 기간 안에 나갈 돈 목록: 고정지출 + 대출 상환 */
function outflowItems(ctx, start, end) {
  return [
    ...fixedIn(ctx.data, start, end),
    ...(ctx.data.debts || []).flatMap((l) => loanPaymentsIn(l, start, end, ctx.now).map((p) => ({ name: l.name, date: p.date, amount: p.amount, loan: true }))),
  ].sort((a, b) => a.date - b.date);
}

/** 달력용: 기간 안의 고정지출·대출 상환 [{name, date, amount, loan}] */
export const outflowsBetween = (data, start, end, now = new Date()) => outflowItems({ data, now: dateOnly(now) }, start, end);

/** 기간 안에 나갈 돈: 고정지출 + 대출 상환 */
function outflow(ctx, start, end, label) {
  const items = outflowItems(ctx, start, end);
  if (!items.length) return { text: `${label}${josa(label, '이', '가')} 없어요.` };
  const sum = items.reduce((a, x) => a + x.amount, 0);
  return { text: `${은(label)} ${wonExact(sum)}이에요. (${items.length}건)\n${items.slice(0, 12).map((x) => `· ${x.date.getMonth() + 1}/${x.date.getDate()} ${x.name} ${wonExact(x.amount)}`).join('\n')}${items.length > 12 ? `\n· 그 밖에 ${items.length - 12}건` : ''}` };
}

/** 항목 이름만 말했을 때 그 항목 요약 */
function entitySummary(ctx, e) {
  const { data, market, now } = ctx;
  if (e.type === 'loan') return H.nextPay({ ...ctx, ents: [e] });
  if (e.type === 'saving') return H.saved({ ...ctx, ents: [e] });
  if (e.type === 'home') return H.home({ ...ctx, ents: [e] });
  if (e.type === 'market') return H.stocks({ ...ctx, ents: [e] });
  if (e.type === 'category') return H.fixedTotal({ ...ctx, ents: [e] });
  if (e.type === 'cal' || e.type === 'partner') return H.schedule({ ...ctx, ents: [e] });
  if (e.type === 'event') return eventWhen(ctx, e.name);
  if (e.type === 'task') {
    const t = e.item;
    if (t.done) return { text: `‘${t.title}’${josa(t.title, '은', '는')} 이미 완료했어요.` };
    return { text: t.due ? `‘${t.title}’ 마감은 ${mdw(fromKey(t.due))}, ${이에요(dueLabel(t.due, ymd(now)))}.` : `‘${t.title}’${josa(t.title, '은', '는')} 날짜 없이 적어 둔 할일이에요.` };
  }
  if (e.type === 'fixed') {
    const f = e.item;
    const d = nextDue(f.day, now);
    return { text: `${은(f.name)} 매달 ${f.day}일에 ${wonExact(f.amount)} 나가요.${f.account ? ` (${f.account})` : ''}${f.active === false ? '\n지금은 멈춤으로 되어 있어요.' : d ? `\n다음 출금은 ${mdw(d)}, ${이에요(dd(daysBetween(now, d)))}.` : ''}` };
  }
  if (e.type === 'stock') {
    const s = e.item;
    const x = stockDetail(s, market);
    const usd = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    const lines = [`${s.name}: ${Number(s.qty || 0).toLocaleString()}주, 평가 ${won(x.valueKrw)}${x.cur === 'USD' ? ` (${usd(x.value)})` : ''}`];
    if (x.ret != null && x.cur === 'USD') lines.push(`달러 기준 ${x.ret >= 0 ? '+' : ''}${pct(x.ret)}`);
    if (x.profitKrw != null) lines.push(`원화 수익 ${x.profitKrw >= 0 ? '+' : '−'}${won(Math.abs(x.profitKrw))} (${x.retKrw >= 0 ? '+' : ''}${pct(x.retKrw)})`);
    if (x.fxEffect != null) lines.push(`주가 효과 ${x.priceEffect >= 0 ? '+' : '−'}${won(Math.abs(x.priceEffect))} · 환율 효과 ${x.fxEffect >= 0 ? '+' : '−'}${won(Math.abs(x.fxEffect))} (매입 환율 ${wonExact(x.buyFx)})`);
    if (x.profitKrw == null && x.ret == null) lines.push('평균 매수가를 넣으면 수익도 알려드릴게요.');
    return { text: lines.join('\n') };
  }
  return { text: `${e.name}에 대해 무엇이 궁금하세요?` };
}

// ───── 일정·할일 ─────
const NOT_LINKED = '구글 캘린더·할일이 아직 연결되지 않았어요. 설정 → 구글 캘린더·할일에서 연결하면 알려드릴게요.';
const shortDay = (d) => `${d.getMonth() + 1}/${d.getDate()} (${'일월화수목금토'[d.getDay()]})`;
const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** 묻는 기간 (기본: 오늘). 지난 기간이면 오늘부터 */
function askRange(ctx, def = 'today') {
  const t = ctx.time;
  if (!t) return def === 'week' ? { start: ctx.now, end: addD(ctx.now, 6 - ((ctx.now.getDay() + 6) % 7)), label: '이번 주' } : { start: ctx.now, end: ctx.now, label: '오늘' };
  let { start, end } = t;
  if (t.loose && end < ctx.now) { start = new Date(start.getFullYear() + 1, start.getMonth(), 1); end = new Date(end.getFullYear() + 1, end.getMonth() + 1, 0); }
  const label = t.label || '그때';
  if (t.kind !== 'day' && start < ctx.now && end >= ctx.now) start = ctx.now;
  return { start, end, label };
}

function scheduleAnswer(ctx) {
  const { start, end, label } = askRange(ctx);
  const one = ymd(start) === ymd(end);
  const money = outflowItems(ctx, start, end);
  const moneyText = money.length ? `\n나갈 돈: ${money.map((x) => `${one ? '' : `${x.date.getMonth() + 1}/${x.date.getDate()} `}${x.name} ${wonExact(x.amount)}`).join(', ')}` : '';
  if (!ctx.agenda) return { text: `${NOT_LINKED}${moneyText ? `\n${label}${moneyText}` : ''}` };
  let events = ctx.agenda.events;
  const cal = ctx.ents.find((e) => e.type === 'cal');
  const partner = ctx.ents.some((e) => e.type === 'partner');
  if (cal) events = events.filter((e) => e.calName === cal.name);
  if (partner) events = events.filter((e) => e.partner);
  const what = cal ? `${cal.name} 일정` : partner ? '반려자 일정' : '일정';
  // 제목을 콕 집었는데 기간을 말하지 않았으면 그 일정이 언제인지
  const ev = ctx.ents.find((e) => e.type === 'event');
  if (ev && !ctx.time && !cal && !partner) return eventWhen(ctx, ev.name);
  const lines = [];
  for (let d = start; d <= end && lines.length < 40; d = addD(d, 1)) {
    const key = ymd(d);
    for (const e of eventsOn(events, key)) {
      if (!one && e.startKey < key && key !== ymd(start)) continue; // 여러 날 일정은 첫날만
      const when = e.allDay ? '종일' : e.startKey < key ? '계속' : e.time;
      lines.push(`· ${one ? '' : `${shortDay(d)} `}${when} ${e.title}${e.partner && !partner ? ' (반려자)' : ''}`);
    }
  }
  const beyond = ctx.agenda.until && ymd(end) > ctx.agenda.until ? `\n(앱에 받아 둔 일정은 ${shortDay(fromKey(ctx.agenda.until))}까지예요. 앱을 열면 새로 받아요.)` : '';
  if (!lines.length) {
    const next = ctx.time ? null : events.filter((e) => e.startKey > ymd(end)).sort((a, b) => a.startKey.localeCompare(b.startKey) || a.time.localeCompare(b.time))[0];
    return { text: `${label}은 ${what}이 없어요.${next ? `\n다음 ${what}은 ${mdw(fromKey(next.startKey))} ${next.allDay ? '' : `${next.time} `}‘${next.title}’이에요.` : ''}${moneyText}${beyond}`, chips: one && label === '오늘' ? [ask1('내일 일정 뭐야?')] : [] };
  }
  return { text: `${label} ${what}${lines.length > 1 ? `은 ${lines.length}개예요` : '이에요'}.\n${lines.join('\n')}${moneyText}${beyond}`, chips: label === '오늘' ? [ask1('오늘 할일 뭐야?')] : [] };
}

/** 이 제목의 일정이 언제인지 (가장 가까운 앞으로의 것) */
function eventWhen(ctx, title) {
  if (!ctx.agenda) return { text: NOT_LINKED };
  const today = ymd(ctx.now);
  const list = ctx.agenda.events.filter((e) => e.title === title).sort((a, b) => a.startKey.localeCompare(b.startKey));
  const e = list.find((x) => x.endKey >= today) || list.at(-1);
  if (!e) return { text: `‘${title}’ 일정을 찾지 못했어요.` };
  const d = fromKey(e.startKey);
  const n = daysBetween(ctx.now, d);
  const rel = n === 0 ? '오늘' : n === 1 ? '내일' : n > 0 ? `${n}일 뒤` : `${-n}일 전`;
  const span = e.endKey !== e.startKey ? `~${mdw(fromKey(e.endKey))}` : '';
  return { text: `‘${e.title}’${josa(e.title, '은', '는')} ${mdw(d)}${span}${e.allDay ? '' : ` ${e.time}`}, ${이에요(rel)}. (${e.calName})` };
}

function tasksAnswer(ctx) {
  if (!ctx.agenda) return { text: NOT_LINKED };
  const today = ymd(ctx.now);
  const g = groupTasks(ctx.agenda.tasks, today);
  const t1 = (t) => `· ${t.title}${t.due && t.due < today ? ` (${dueLabel(t.due, today)})` : ''}`;
  const tk = ctx.ents.find((e) => e.type === 'task');
  if (tk && !ctx.time) return entitySummary(ctx, tk);
  if (/끝낸|완료한|끝냈|했던/.test(ctx.q)) {
    const done = g.done.slice(0, 8);
    return { text: done.length ? `최근에 끝낸 일이에요.\n${done.map((t) => `· ${t.title}${t.completedAt ? ` (${Number(t.completedAt.slice(5, 7))}/${Number(t.completedAt.slice(8))})` : ''}`).join('\n')}` : '최근 30일 동안 완료한 할일이 없어요.' };
  }
  if (/밀린|못한|안한|지난|놓친/.test(ctx.q)) {
    return { text: g.overdue.length ? `마감이 지난 할일이 ${g.overdue.length}개예요.\n${g.overdue.map(t1).join('\n')}` : '마감이 지난 할일은 없어요.' };
  }
  const { start, end, label } = askRange(ctx, /이번주|금주|다음주|담주|이번달|다음달/.test(ctx.q) ? 'week' : 'today');
  const s = ymd(start);
  const e = ymd(end);
  const open = ctx.agenda.tasks.filter((t) => !t.done && t.due && t.due >= s && t.due <= e).sort((a, b) => a.due.localeCompare(b.due) || (a.time || '99').localeCompare(b.time || '99'));
  const isToday = s === today && e === today;
  const one = s === e;
  const lines = open.map((t) => `· ${one ? '' : `${shortDay(fromKey(t.due))} `}${t.time ? `${t.time} ` : ''}${t.title}`);
  const late = isToday && g.overdue.length ? `\n지난 할일도 ${g.overdue.length}개 있어요.\n${g.overdue.map(t1).join('\n')}` : '';
  const nodate = isToday && !open.length && !g.overdue.length && g.nodate.length ? `\n날짜 없이 적어 둔 할일은 ${g.nodate.length}개 있어요.` : '';
  if (!open.length) return { text: `${label} 마감인 할일은 없어요.${late}${nodate}` };
  return { text: `${label} 할일은 ${open.length}개예요.\n${lines.join('\n')}${late}` };
}

// ───── 일정·할일 넣기 ─────
const ADD_RE = /(추가|넣어|넣기|넣자|잡아줘|잡아줄|잡자|등록|저장해줘|적어줘|기록해줘|메모해줘)/;
const CMD_RE = /\s*(을|를)?\s*(일정|할일|할 일|약속|스케줄|투두)?\s*(을|를|으로|로|에)?\s*(캘린더|구글|달력|목록)?(에|에다)?\s*(좀\s*)?(추가|넣어|넣기|넣자|잡아|잡자|등록|저장|적어|기록|메모)[\s\S]*$/;

/** 질문에서 넣을 내용만: '내일 3시 상담 일정 잡아 줘' → '내일 3시 상담' */
export function stripCommand(raw) {
  return String(raw).trim()
    .replace(/^(일정|할일|할 일|투두)(에|으로|로)?\s+/, '')
    .replace(CMD_RE, '')
    .replace(/[.!?~]+$/, '')
    .trim();
}

function addAnswer(ctx, now) {
  if (!ctx.agenda) return { text: NOT_LINKED };
  const isTask = /할일|투두|todo|해야/.test(ctx.q);
  const body = stripCommand(ctx.raw);
  if (isTask) {
    const { title, due, repeat, time } = parseQuickTask(body, now);
    if (!title) return { text: '어떤 할일을 넣을까요? 예: ‘금요일까지 보고서 할일 추가해줘’' };
    return {
      text: `이 할일을 넣을까요?\n· ${title}${due ? ` (${mdw(fromKey(due))}${time ? ` ${time}` : ''}까지)` : time ? ` (${time})` : ' (날짜 없음)'}${repeat ? `\n· 반복: ${repeatLabel(repeat, due)} (끝내면 다음 차례를 만들어요)` : ''}`,
      action: { kind: 'task', title, due, ...(time ? { time } : {}), ...(repeat ? { repeat } : {}) },
    };
  }
  const p = parseEventInput(body, now, ctx.agenda.calendars || [], ctx.agenda.keywords || []);
  if (!p.title) return { text: '어떤 일정을 넣을까요? 예: ‘금요일 7시 헬스 넣어줘’' };
  const ev = { ...p, date: p.date || ymd(ctx.now) };
  const want = p.calName;
  const cal = (ctx.agenda.calendars || []).find((c) => c.name.toLowerCase() === want.toLowerCase());
  return {
    text: `이 일정을 넣을까요?\n· ${eventLine(ev)}${p.repeat ? `\n· 반복: ${repeatLabel(p.repeat, ev.date)}` : ''}\n· 캘린더: ${cal?.name || want}${p.date ? '' : '\n날짜를 말씀하지 않아서 오늘로 넣을게요.'}${p.allDay ? '\n시간을 말씀하지 않아서 종일 일정이에요.' : ''}`,
    action: { kind: 'event', ev: { ...ev, calName: cal?.name || want } },
  };
}

// ───── 일정 옮기기·지우기 ─────
const MOVE_RE = /(옮겨|옮기|바꿔|바꾸|변경|미뤄|미루|당겨|당기|이동)/;
const DEL_RE = /(지워|지우|삭제|없애|취소해|취소하|빼줘|빼 줘)/;
const RAW_MOVE = /\s*(?:으로|로)\s*(?:좀\s*)?(?:옮겨|옮기|바꿔|바꾸|변경|미뤄|미루|당겨|당기|이동)/;

/** 말한 일정 찾기: 제목이 가장 비슷하고, 날짜를 말했으면 그날, 아니면 가장 가까운 앞으로의 일정 */
function findEvent(ctx, text) {
  const q = norm(text.replace(/일정|약속|스케줄/g, ''));
  const day = parseTime(q, ctx.now);
  const today = ymd(ctx.now);
  let best = [];
  let top = 0;
  for (const e of ctx.agenda.events) {
    const sc = nameScore(q, e.title);
    if (sc < 3) continue;
    if (day?.kind === 'day' && e.startKey !== ymd(day.start)) continue;
    if (sc > top) { top = sc; best = [e]; } else if (sc === top) best.push(e);
  }
  best.sort((a, b) => (a.startKey < today) - (b.startKey < today) || a.startKey.localeCompare(b.startKey) || a.time.localeCompare(b.time));
  return best[0] || null;
}
const whenOf = (e) => `${eventLine({ ...e, date: e.startKey }).replace(` ${e.title}`, '')}`;

function changeAnswer(ctx, now) {
  const raw = ctx.raw.trim();
  const isDel = DEL_RE.test(ctx.q) && !MOVE_RE.test(ctx.q);
  // 옮기기: '…을/를 [새 날짜·시간](으)로 옮겨줘'
  let source = raw;
  let target = '';
  if (!isDel) {
    const m = raw.match(RAW_MOVE);
    const before = m ? raw.slice(0, m.index) : raw.replace(/(옮겨|옮기|바꿔|바꾸|변경|미뤄|미루|당겨|당기|이동)[\s\S]*$/, '');
    const obj = before.match(/^(.*\S)(?:을|를)\s+(.*)$/);
    if (obj) { source = obj[1]; target = m ? obj[2] : ''; } else { source = before; target = ''; }
    // '을/를' 없이 '면담 수요일 2시로 옮겨줘': 제목 뒤를 새 날짜로
    if (!obj && m) {
      const e0 = findEvent(ctx, before);
      if (e0) { const i = before.indexOf(e0.title); if (i >= 0) { source = before.slice(0, i + e0.title.length); target = before.slice(i + e0.title.length); } }
    }
  }
  const e = findEvent(ctx, isDel ? raw.replace(DEL_RE, ' ') : source);
  if (!e) return null; // 일정을 못 찾으면 다른 답으로
  if (e.partner || !(ctx.agenda.calendars || []).some((c) => c.id === e.calId)) return { text: `‘${e.title}’${josa(e.title, '은', '는')} ${e.partner ? '반려자' : '보기만 하는'} 캘린더 일정이라 여기서 바꿀 수 없어요.` };
  const base = { kind: '', calId: e.calId, id: e.id, title: e.title };
  if (isDel) {
    return { text: `이 일정을 지울까요?\n· ${whenOf(e)} ${e.title}${e.recurring ? '\n반복 일정이라 이 날 하나만 지워요.' : ''}`, action: { ...base, kind: 'delete' } };
  }
  const p = parseQuickEvent(String(target).replace(/에$/, ''), now);
  if (!p.date && p.allDay) return { text: `‘${e.title}’(${whenOf(e)})을 언제로 옮길까요?\n예: ‘${e.title} 수요일 오후 2시로 옮겨줘’` };
  const len = e.allDay ? 0 : (toMin(e.endTime) - toMin(e.time) + 1440) % 1440 || 60;
  const to = { date: p.date || e.startKey, allDay: p.allDay ? e.allDay : false, time: p.allDay ? e.time : p.time, endTime: '' };
  if (!to.allDay) to.endTime = p.time && p.endTime && p.endTime !== hmOf(toMin(p.time) + 60) ? p.endTime : hmOf(toMin(to.time) + len);
  const span = e.allDay && e.endKey > e.startKey ? Math.round((fromKey(e.endKey) - fromKey(e.startKey)) / 86400000) : 0;
  if (span) to.endDate = ymd(new Date(fromKey(to.date).getTime() + span * 86400000));
  return {
    text: `이 일정을 옮길까요?\n· ${whenOf(e)} ${e.title}\n→ ${eventLine({ ...to, title: '' }).trim()}${e.recurring ? '\n반복 일정이라 이 날 하나만 옮겨요.' : ''}`,
    action: { ...base, kind: 'move', to },
  };
}
const toMin = (hm) => (hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : 0);
const hmOf = (m) => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, '0')}:${String(Math.min(m, 1439) % 60).padStart(2, '0')}`;

// ───── 메모 ─────
const MEMO_SAVE = /(메모해|메모로남겨|메모남겨|메모해둬|적어둬|기억해둬|기억해줘)/;

function memoSave(raw) {
  const text = String(raw).trim()
    .replace(/^메모\s*[:：]\s*/, '')
    .replace(/\s*(?:이?라고|을|를)?\s*(?:좀\s*)?(?:메모|적어|기억)[\s\S]*$/, '')
    .trim();
  if (!text) return { text: '무엇을 메모할까요? 예: ‘와이파이 비밀번호 바뀜 메모해줘’' };
  return { text: `메모해 둘게요.\n· ${text}`, action: { kind: 'memo', text } };
}

function memoFind(q, memos) {
  const list = [...(memos || [])].sort((a, b) => (!!b.pinned - !!a.pinned) || (b.createdAt || 0) - (a.createdAt || 0));
  if (!list.length) return { text: '아직 메모가 없어요. ‘…메모해줘’라고 하면 메모에 저장해 둘게요.' };
  const word = q.replace(/메모|보여줘|보여|알려줘|알려|찾아줘|찾아|뭐있어|뭐야|뭐|있어|에서|좀|내|최근|목록|전부|다/g, '');
  const hits = word.length >= 2 ? list.filter((m) => norm(m.text).includes(word)) : list;
  const line = (m) => `· ${String(m.text).split('\n')[0]}${m.pinned ? ' (고정)' : ''}`;
  if (word.length >= 2 && !hits.length) return { text: `‘${word}’ 들어간 메모는 없어요.` };
  return { text: `${word.length >= 2 ? `‘${word}’ 들어간 메모예요.` : `메모 ${list.length}개 중 최근 것이에요.`}\n${hits.slice(0, 5).map(line).join('\n')}${hits.length > 5 ? `\n· 그 밖에 ${hits.length - 5}개` : ''}` };
}
