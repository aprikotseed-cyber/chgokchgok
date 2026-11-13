import { connect, isDemo } from './store.js?v=20261113d';
import { currentTotals, currentPayment, homeValue, loanThisMonth, graduatedInfo, loanBalance, stockDetail, stockMarket, normTicker } from './projection.js?v=20261113d';
import { parseSchedule, scheduleBalanceAt, nextScheduled, paidRows, ymd } from './schedule.js?v=20261113d';
import { upsertRecord, deleteRecord, yearlySummary, monthlySummary, byTarget, today, scheduleRecords } from './records.js?v=20261113d';
import { upcoming, fixedSummary, subsSummary, cycleLabel, nextDue, daysBetween, ALERT_DAYS, alertsFor } from './reminders.js?v=20261113d';
import { won, wonExact, pct, esc, ymLabel, dateTime, mdw } from './format.js?v=20261113d';
import { trendChart, homeChart, redrawAll } from './charts.js?v=20261113d';
import { trend, makeEntry, sameEntry, sinceLast } from './history.js?v=20261113d';
import { estimateMonths } from './estimate.js?v=20261113d';
import { ask, outflowsBetween, pickChoice } from './assistant.js?v=20261113d';
import { applyTrade, undoLastTrade, realizedKrw } from './trades.js?v=20261113d';
import { addFeedback, feedbackText } from './feedback.js?v=20261113d';
import { repoFromLocation, dispatchWorkflow, WORKFLOWS, autoRefreshPlan } from './github.js?v=20261113d';
import { createGoogle, freshServerToken } from './google.js?v=20261113d';
import { initLock, lockNow, lockConfig, lockSupported, enableLock, enablePin, disableLock, setLockAfter } from './lock.js?v=20261113d';
import { createDemoGoogle } from './google-demo.js?v=20261113d';
import { makeTask, normLocalTask, nextRepeatTask } from './tasks.js?v=20261113d';
import { depositTotal, yearTable, depositYears } from './deposits.js?v=20261113d';
import { normEvent, eventsOn, agendaDays, groupTasks, todayTasks, parseQuickTask, dueLabel, toTaskDue, fromKey, PARTNER_NAMES, calPref as calPrefOf, visibleEvents, agendaUntil, parseQuickEvent, classifyEvent, toGoogleEvent, eventLine, fetchAgenda, keepExternal, parseEventInput, nextFrom, repeatLabel, REPEAT_CHOICES, ruleFromChoice, choiceOf } from './agenda.js?v=20261113d';

const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

const EMPTY = () => ({
  savings: [], deposits: [], stocks: [], homes: [], debts: [], fixed: [],
  settings: {}, snapshots: {}, records: [],
});

const state = {
  user: null, data: EMPTY(), market: {}, sync: '',
  tab: location.hash.slice(1) || 'home',
  recYear: String(new Date().getFullYear()),
  day: today(),          // 날짜가 바뀌면 화면을 다시 그리기 위해 기억
  open: new Set(),       // 펼쳐 둔 <details> (실시간 갱신 때도 유지)
  push: { loaded: false, supported: false, devices: [] },
  stockTab: null,        // 주식 묶음: kr / us / pension
  marketRaw: {},
  history: {},          // 하루 한 줄 자산 기록 {날짜: {...}}
  secrets: {},          // GitHub 토큰 등 (Firestore에 따로)
  refresh: null,        // [지금 업데이트] 요청 상태 {at, kind, quotesAt}
  reorder: null,        // 순서 바꾸는 중인 목록 (예: 'savings')
  dragging: false,
  memos: [],            // 메모 [{id, text, pinned, createdAt, updatedAt}]
  agenda: null,         // 구글 캘린더에서 받아 둔 일정 {calendars, events, syncedAt}
  tasks: [],            // 할일 (차곡차곡에 직접 저장)
  gsync: '',            // '' | 'busy' | 'auth'(다시 연결 필요) | 오류 문구
  calDays: 14,
};
let store;

// ───────────────────────── 입력 항목 ─────────────────────────
const SIGUNGU = [
  ['41135', '성남시 분당구'], ['41131', '성남시 수정구'], ['41133', '성남시 중원구'],
  ['41465', '용인시 수지구'], ['41463', '용인시 기흥구'], ['41461', '용인시 처인구'],
  ['41117', '수원시 영통구'], ['41115', '수원시 팔달구'], ['41113', '수원시 권선구'], ['41111', '수원시 장안구'],
  ['41450', '하남시'], ['41610', '광주시'], ['41290', '과천시'], ['41430', '의왕시'],
  ['11680', '서울 강남구'], ['11650', '서울 서초구'], ['11710', '서울 송파구'], ['11740', '서울 강동구'],
  ['11440', '서울 마포구'], ['11170', '서울 용산구'], ['11200', '서울 성동구'], ['11215', '서울 광진구'],
  ['11590', '서울 동작구'], ['11560', '서울 영등포구'], ['11470', '서울 양천구'], ['11350', '서울 노원구'],
];

const FIXED_CATS = ['주거', '통신', '보험', '구독', '교통', '공과금', '교육', '기부·후원', '모임·데이트', '기타'];

const FORMS = {
  memo: {
    title: '메모',
    fields: [
      { key: 'text', label: '메모', type: 'textarea', required: true },
      { key: 'pinned', label: '맨 위에 고정', type: 'check' },
    ],
  },
  event: {
    title: '일정',
    fields: [
      { key: 'title', label: '일정', type: 'text', required: true },
      { key: 'calId', label: '캘린더', type: 'select', options: [] }, // 열 때 내 캘린더 목록으로 채워요
      { key: 'allDay', label: '시간', type: 'seg', str: true, options: [['all', '종일'], ['time', '시간 지정']], def: 'all' },
      { key: 'date', label: '날짜', type: 'date' },
      { key: 'endDate', label: '끝나는 날', type: 'date', optional: true, showIf: { allDay: 'all' }, hint: '여러 날 이어지는 일정일 때만' },
      { key: 'time', label: '시작', type: 'time', showIf: { allDay: 'time' } },
      { key: 'endTime', label: '끝', type: 'time', showIf: { allDay: 'time' } },
      { key: 'repeat', label: '반복', type: 'select', options: REPEAT_CHOICES, hint: '구글 캘린더 반복 일정으로 들어가요' },
      { key: 'location', label: '장소', type: 'text', placeholder: '선택' },
    ],
  },
  task: {
    title: '할일',
    fields: [
      { key: 'title', label: '할일', type: 'text', required: true },
      { key: 'due', label: '마감일', type: 'date', optional: true, hint: '비워 두면 날짜 없는 할일이에요.' },
      { key: 'time', label: '시간', type: 'time', hint: '선택. 시간을 넣으면 30분 전에 알려 드려요.' },
      { key: 'repeat', label: '반복', type: 'select', options: REPEAT_CHOICES, hint: '끝내면 다음 차례 할일을 만들어 드려요' },
      { key: 'notes', label: '메모', type: 'text', placeholder: '선택' },
    ],
  },
  savings: {
    title: '저축·현금',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '주거래 적금', required: true },
      { key: 'kind', label: '종류', type: 'select', options: ['예금', '적금', '파킹통장', '연금', '청약', '보증금', '기타'] },
      { key: 'balance', label: '현재 잔액', type: 'won' },
      { key: 'monthly', label: '매달 넣는 돈', type: 'won' },
      { key: 'rate', label: '연 이자율', type: 'pct' },
    ],
  },
  deposits: {
    title: '예·적금',
    fields: [
      { key: 'name', label: '상품 이름', type: 'text', placeholder: '청년희망적금', required: true },
      { key: 'type', label: '종류', type: 'seg', str: true, def: '적금', options: [['적금', '적금'], ['예금', '예금']] },
      { key: 'accountId', label: '연결할 저축·현금 계좌', type: 'acct', hint: '연결하면 그 계좌에 입금한 기록이 이 상품의 납입으로 잡혀요. ‘납입’ 버튼으로 넣으면 계좌 잔액에도 더해져요.' },
      { key: 'amount', label: '금액', type: 'won', hint: '적금은 매달 넣는 돈, 예금은 처음 맡긴 돈' },
      { key: 'start', label: '가입일', type: 'date' },
      { key: 'maturity', label: '만기일', type: 'date', optional: true },
      { key: 'rate', label: '연 금리', type: 'pct', hint: '예금은 이 금리로 다달이 붙는 이자(세전, 예상)를 더해 보여줘요' },
    ],
  },
  stocks: {
    title: '주식 종목',
    fields: [
      { key: 'market', label: '구분', type: 'select', options: [['kr', '국내주식'], ['us', '해외주식'], ['pension', '연금저축']] },
      { key: 'name', label: '종목 이름', type: 'text', placeholder: 'S&P500 ETF', required: true },
      { key: 'ticker', label: '종목코드', type: 'text', placeholder: '005930 또는 VOO', hint: '국내는 6자리 코드, 해외는 티커. 매일 아침 시세를 가져와요' },
      { key: 'qty', label: '보유 수량', type: 'number', unit: '주', hint: '처음 등록할 때의 보유 수량이에요. 이후로는 매수·매도 버튼으로 쌓아 가면 돼요' },
      { key: 'avgPrice', label: '평균 매수가', type: 'cmoney', curKey: 'avgCur' },
      { key: 'costKrw', label: '원화 매입금액 (총액)', type: 'won', showIf: { market: 'us' }, hint: '증권사 앱의 원화 매입금액. 평균 매수가($)와 비교해 매입 환율과 환율 효과를 계산해요' },
      { key: 'manualPrice', label: '수동 현재가', type: 'cmoney', curKey: 'manualCur', hint: '자동 시세가 없을 때만 써요' },
    ],
  },
  fx: {
    title: '달러 환율',
    fields: [{ key: 'usdKrw', label: '1달러', type: 'won', hint: '자동 환율을 아직 못 받았을 때만 써요. 자동 환율이 들어오면 그걸 우선해요' }],
  },
  homes: {
    title: '주택',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '우리 집', required: true },
      { key: 'lawdCd', label: '시군구', type: 'sigungu', hint: '목록에 없으면 법정동코드 앞 5자리를 입력하세요' },
      { key: 'aptName', label: '단지명', type: 'text', placeholder: '한솔마을', hint: '실거래가 신고 이름의 일부만 써도 돼요' },
      { key: 'area', label: '전용면적', type: 'number', unit: '㎡', hint: '±2㎡ 안의 거래만 써요 (84타입이면 84)' },
      { key: 'share', label: '내 지분', type: 'pct', def: 100 },
      { key: 'purchasePrice', label: '구매 가격', type: 'won', hint: '집 전체 매매가. 지금 시세와 비교해서 오른 금액과 수익률을 보여드려요 (지분만큼 계산)' },
      { key: 'purchaseDate', label: '구매 시기 (선택)', type: 'month' },
      { key: 'useAuto', label: '실거래가로 시세 자동 반영', type: 'check', def: true },
      { key: 'manualPrice', label: '직접 입력 시세', type: 'won', hint: '자동 시세를 끄거나 아직 거래가 없을 때 사용' },
    ],
  },
  debts: {
    title: '대출',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '아낌e보금자리론', required: true },
      { key: 'kind', label: '종류', type: 'select', options: ['주택담보대출', '신용대출', '교직원공제회', '기타'] },
      { key: 'schedule', label: '상환스케줄', type: 'schedule' },
      { key: 'original', label: '처음 빌린 금액', type: 'won', noSchedule: true, hint: '상환 진행률 표시용 (선택)' },
      { key: 'balance', label: '현재 남은 원금', type: 'won', noSchedule: true },
      { key: 'rate', label: '연 금리', type: 'pct' },
      { key: 'method', label: '상환 방식', type: 'select', options: [['annuity', '원리금균등'], ['grace_annuity', '거치 후 원리금균등'], ['equal', '원금균등'], ['graduated', '체증식'], ['bullet', '만기일시']], noSchedule: true },
      { key: 'graceYears', label: '거치 기간', type: 'seg', options: [[1, '1년'], [2, '2년'], [3, '3년']], def: 1, showIf: { method: 'grace_annuity' }, noSchedule: true, hint: '거치 기간에는 이자만 내고, 끝나면 남은 기간 동안 원리금균등으로 갚아요' },
      { key: 'startDate', label: '대출 실행월', type: 'month', showIf: { method: 'grace_annuity' }, noSchedule: true, hint: '거치 기간이 언제 끝나는지 계산하는 데 써요' },
      { key: 'payment', label: '이번 달 원리금', type: 'won', showIf: { method: 'graduated' }, noSchedule: true, hint: '은행 앱·상환 스케줄표의 이번 달 납입액. 이걸로 매달 늘어나는 금액을 계산해요' },
      { key: 'payDay', label: '매달 상환일', type: 'day', noSchedule: true, hint: '상환일 당일 아침 브리핑에 넣어 드려요 (앱 화면 알림은 5·3·1일 전부터)' },
      { key: 'maturity', label: '만기', type: 'month', noSchedule: true },
      { key: 'graceEnd', label: '거치기간 끝 (선택)', type: 'month', showIf: { method: ['annuity', 'equal', 'graduated'] }, noSchedule: true, hint: '이때까지는 이자만 내요' },
      { key: 'account', label: '출금 계좌', type: 'text', placeholder: '예: 신한 주거래 통장', hint: '상환일 알림과 일정에 함께 보여드려요' },
    ],
  },
  fixed: {
    title: '고정지출',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '휴대폰 요금', required: true },
      { key: 'category', label: '분류', type: 'select', options: FIXED_CATS },
      { key: 'amount', label: '금액', type: 'won' },
      { key: 'cycle', label: '나가는 주기', type: 'seg', str: true, def: 'monthly', options: [['monthly', '매달'], ['yearly', '매년']] },
      { key: 'month', label: '출금 월', type: 'select', options: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]), showIf: { cycle: 'yearly' } },
      { key: 'day', label: '출금일', type: 'day', hint: '출금일 당일 아침 브리핑에 넣어 드려요. 31일은 짧은 달엔 말일로 계산해요' },
      { key: 'account', label: '출금 계좌·카드 (선택)', type: 'text', placeholder: '주거래 통장' },
      { key: 'active', label: '지금 나가고 있는 지출', type: 'check', def: true, hint: '잠시 멈춘 구독 등은 끄면 합계와 알림에서 빠져요' },
    ],
  },
  saving: {
    title: '입금 기록',
    fields: [
      { key: 'targetId', label: '계좌', type: 'ref', source: 'savings' },
      { key: 'date', label: '날짜', type: 'date', hint: '오늘 날짜가 들어가 있어요. 빠뜨린 예전 기록은 날짜만 바꾸면 돼요' },
      { key: 'amount', label: '저축한 금액', type: 'won' },
      { key: 'kind', label: '구분', type: 'select', options: ['정기 납입', '추가 납입'] },
      { key: 'memo', label: '메모', type: 'text', placeholder: '선택' },
      { key: 'applied', label: '계좌 잔액에 더하기', type: 'check', def: true, hint: '잔액에 이미 포함된 예전 기록이면 끄세요' },
    ],
  },
  withdraw: {
    title: '출금 기록',
    fields: [
      { key: 'targetId', label: '계좌', type: 'ref', source: 'savings' },
      { key: 'date', label: '날짜', type: 'date', hint: '오늘 날짜가 들어가 있어요. 빠뜨린 예전 기록은 날짜만 바꾸면 돼요' },
      { key: 'amount', label: '뺀 금액', type: 'won' },
      { key: 'kind', label: '구분', type: 'select', options: ['출금', '해지', '이체'] },
      { key: 'memo', label: '메모', type: 'text', placeholder: '예: 여행 경비' },
      { key: 'applied', label: '계좌 잔액에서 빼기', type: 'check', def: true, hint: '잔액에 이미 반영된 예전 기록이면 끄세요' },
    ],
  },
  repayment: {
    title: '상환 기록',
    fields: [
      { key: 'targetId', label: '대출', type: 'ref', source: 'debts', filter: (l) => !l.schedule?.length },
      { key: 'date', label: '날짜', type: 'date', hint: '오늘 날짜가 들어가 있어요. 빠뜨린 예전 기록은 날짜만 바꾸면 돼요' },
      { key: 'amount', label: '갚은 원금', type: 'won', hint: '이번 달 예상 원금이에요. 은행 내역대로 고치면 돼요' },
      { key: 'interest', label: '함께 낸 이자', type: 'won' },
      { key: 'kind', label: '구분', type: 'select', options: ['정기 상환', '중도 상환'] },
      { key: 'memo', label: '메모', type: 'text', placeholder: '선택' },
      { key: 'applied', label: '대출 잔액에서 빼기', type: 'check', def: true, hint: '잔액에 이미 반영된 예전 기록이면 끄세요' },
    ],
  },
};
const isRecord = (kind) => kind === 'saving' || kind === 'withdraw' || kind === 'repayment';
const REC_LABEL = { saving: '입금', withdraw: '출금', repayment: '상환' };
const METHOD = { annuity: '원리금균등', grace_annuity: '거치 후 원리금균등', equal: '원금균등', graduated: '체증식', bullet: '만기일시' };

/** 계좌·대출을 고르면 미리 채울 금액 */
function recordDefaults(type, targetId) {
  if (type === 'saving') {
    const s = (state.data.savings || []).find((x) => x.id === targetId);
    return { amount: Number(s?.monthly) || '', kind: '정기 납입' };
  }
  if (type === 'withdraw') return { amount: '', kind: '출금' };
  const l = (state.data.debts || []).find((x) => x.id === targetId);
  if (!l) return {};
  const m = loanThisMonth(l);
  return { amount: Math.round(m.principal), interest: Math.round(m.interest), kind: '정기 상환' };
}

// ───────────────────────── 저장 ─────────────────────────
/** 자동 환율이 없으면 직접 넣은 환율을 써요 */
function refreshMarket() {
  const raw = state.marketRaw || {};
  const usd = raw.fx?.USD || Number(state.data.settings?.usdKrw) || 0;
  state.market = { ...raw, fx: { ...(raw.fx || {}), USD: usd }, fxAuto: !!raw.fx?.USD };
}

let saveTimer;
function commit() {
  refreshMarket();
  render();
  recordDaily();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveChanges, 300);
}

/**
 * 서버에서 마지막으로 받은 내용(serverBase)과 비교해서 바뀐 칸만 저장해요.
 * 예전에는 전체를 통째로 저장해서, 오래 켜 둔 휴대폰이 PC에서 고친 자산을 덮어쓸 수 있었어요.
 */
let serverBase = null;
function saveChanges() {
  const cur = JSON.parse(JSON.stringify(state.data));
  const fail = (e) => toast(`저장하지 못했어요: ${e.message}`);
  if (!serverBase || !store.update) { store.save(cur).catch(fail); serverBase = cur; return; }
  const changes = {};
  for (const k of new Set([...Object.keys(cur), ...Object.keys(serverBase)])) {
    if (JSON.stringify(cur[k]) !== JSON.stringify(serverBase[k])) changes[k] = cur[k];
  }
  serverBase = cur;
  store.update(changes, cur).catch(fail);
}

/** 오늘의 자산 기록 (값이 바뀌었을 때만 저장) */
let historyTimer;
function recordDaily() {
  if (!state.user || !state.historyLoaded) return;
  const t = currentTotals(state.data, state.market);
  if (!t.assets && !t.debts) return;
  const day = today();
  const entry = makeEntry(t);
  if (sameEntry(state.history[day], entry)) return;
  state.history = { ...state.history, [day]: entry };
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => store.saveHistory(day, entry).catch(() => {}), 1500);
}

/** 이번 달 합계를 남겨 두면 '지난달 대비' 변화를 보여줄 수 있어요 */
function recordSnapshot() {
  const t = currentTotals(state.data, state.market);
  if (!t.assets && !t.debts) return;
  const ym = today().slice(0, 7);
  const prev = state.data.snapshots?.[ym];
  const next = { assets: Math.round(t.assets), debts: Math.round(t.debts), net: Math.round(t.net) };
  if (prev && prev.assets === next.assets && prev.debts === next.debts) return;
  state.data.snapshots = { ...(state.data.snapshots || {}), [ym]: next };
  // 이 칸만 저장해요. 전체를 저장하면, 아직 새 내용을 못 받은 기기(오래 켜 둔 휴대폰 등)가
  // 시세가 바뀔 때 예전 내용으로 다른 기기의 수정을 덮어쓸 수 있어요.
  store.saveSnapshot?.(ym, next).catch(() => {});
}

// ───────────────────────── 화면 조각 ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const now = () => new Date();

/** 한 줄 항목: 왼쪽 이름·설명, 오른쪽 금액 */
function row({ kind, id, title, meta = '', value = '', sub = '', cls = '', action = 'edit', readOnly = false }) {
  const inner = `<span class="row-main"><span class="row-title">${title}</span>${meta ? `<span class="row-meta">${meta}</span>` : ''}</span>
    <span class="row-side"><span class="row-value">${value}</span>${sub ? `<span class="row-meta">${sub}</span>` : ''}</span>`;
  // 읽기 전용 줄은 눌러도 아무 일도 없어요 (홈 화면 등)
  if (readOnly) return `<div class="row static ${cls}">${inner}</div>`;
  return `<button class="row ${cls}" data-action="${action}" data-kind="${kind}" data-id="${esc(id)}">${inner}</button>`;
}

function section(title, body, { sum = '', action = '' } = {}) {
  return `<section class="block">
    <header class="block-head"><h2>${title}${sum ? `<span class="sum">${sum}</span>` : ''}</h2>${action}</header>
    ${body}
  </section>`;
}

const addBtn = (kind, label = '추가') => `<button class="link-btn" data-action="add" data-kind="${kind}">+ ${label}</button>`;

/** 목록 머리 버튼: [↑↓ 순서 바꾸기] [+ 추가], 순서 바꾸는 중에는 [완료] */
function listActions(key, count) {
  if (state.reorder === key) return `<button class="link-btn done" data-action="reorder" data-key="${key}">완료</button>`;
  return `<span class="head-actions">${count > 1 ? `<button class="link-btn sort-btn" data-action="reorder" data-key="${key}" aria-label="순서 바꾸기" title="순서 바꾸기">↑↓</button>` : ''}${addBtn(key)}</span>`;
}

/** 순서 바꾸기 목록: 손잡이(≡)를 끌거나, 손잡이에서 ↑/↓ 키로 */
function sortList(key, items, view) {
  return `<p class="hint sort-hint">손잡이(≡)를 끌어서 순서를 바꾸고, 다 되면 완료를 눌러 주세요.</p>
  <div class="panel list sortable" data-sort="${key}">${(items || []).map((it) => {
    const v = view(it);
    return `<div class="row static sort-row" data-id="${esc(it.id)}">
      <span class="handle" tabindex="0" role="button" aria-label="${v.title} 순서 옮기기 (위아래 화살표 키)">≡</span>
      <span class="row-main"><span class="row-title">${v.title}</span></span>
      <span class="row-side"><span class="row-value">${v.value}</span></span>
    </div>`;
  }).join('')}</div>`;
}

/** 화면에 보이는 순서대로 저장 */
function saveOrder(listEl) {
  const key = listEl.dataset.sort;
  const ids = [...listEl.querySelectorAll('.sort-row')].map((r) => r.dataset.id);
  const byId = new Map((state.data[key] || []).map((x) => [x.id, x]));
  state.data[key] = [...ids.map((id) => byId.get(id)).filter(Boolean), ...(state.data[key] || []).filter((x) => !ids.includes(x.id))];
  commit();
}
const empty = (text) => `<p class="empty">${text}</p>`;
const details = (key, summary, body) => `<details data-key="${key}" ${state.open.has(key) ? 'open' : ''}><summary>${summary}</summary>${body}</details>`;
const dday = (n) => (n === 0 ? '오늘' : `D-${n}`);

// ───────────────────────── 대시보드 ─────────────────────────
// 오늘: 비서 입력줄 + 오늘 일정·할일
function viewHome() {
  return `
  <form id="home-ask" class="ask-box" autocomplete="off">
    <label for="home-ask-input" class="ask-label"><img src="assistant-mark.png" alt="비서" width="22" height="22"></label>
    <textarea id="home-ask-input" rows="3" enterkeyhint="send" aria-label="비서에게 메시지"></textarea>
    <button class="ask-send" type="submit">보내기</button>
  </form>
  ${todayBlock()}
  ${monthBlock()}`;
}

// 자산 → 홈: 총자산, 자산 추이, 고정지출·상환 일정
function viewMoney() {
  const d = state.data;
  const t = currentTotals(d, state.market);
  const saved = t.savings + t.stocks;
  const ym = today().slice(0, 7);
  const prevKey = Object.keys(d.snapshots || {}).filter((k) => k < ym).sort().pop();
  const diff = prevKey ? t.net - d.snapshots[prevKey].net : null;
  const pay = (d.debts || []).reduce((a, l) => a + currentPayment(l), 0);
  const isEmpty = !t.assets && !t.debts;

  const mode = d.settings?.trendMode || 'day';
  const tr = trendOf(mode);
  const RANGE = { day: '최근 30일', month: '최근 12개월', year: '전체 기간' };

  const soon = upcoming(d, now(), 14);
  const noPayDay = (d.debts || []).some((l) => !l.schedule?.length && loanBalance(l) > 0 && !l.payDay);

  return `
  ${isEmpty ? `<p class="notice">아직 입력된 자산이 없어요. <a href="#assets">자산</a>과 <a href="#debts">부채</a>에서 하나씩 추가해 보세요.</p>` : ''}
  <div class="summary">
  <section class="hero">
    <div class="eyebrow">총자산</div>
    <div class="hero-num">${won(t.net)}</div>
    ${dayDelta(t)}
    ${diff != null ? `<div class="delta small ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${won(Math.abs(diff))}<span>${ymLabel(prevKey)} 대비</span></div>` : ''}
  </section>

  <section class="panel stats">
    <a class="stat" href="#assets"><span class="eyebrow">저축액${t.stocks ? ' · 주식 포함' : ''}</span><span class="stat-num">${won(saved)}</span></a>
    <span class="stat-op">+</span>
    <a class="stat" href="#assets"><span class="eyebrow">주택</span><span class="stat-num">${won(t.homes)}</span></a>
    <span class="stat-op">−</span>
    <a class="stat" href="#debts"><span class="eyebrow">대출잔액</span><span class="stat-num">${won(t.debts)}</span><span class="stat-sub">이번 달 상환 ${won(pay)}</span></a>
  </section>
  </div>

  <div class="cols"><div class="col-side">
  ${section('고정지출·상환 일정', `<div class="panel list">${soon.length ? soon.map(scheduleRow).join('') : empty('2주 안에 나갈 대출 상환이나 고정지출이 없어요.')}</div>
    <p class="hint">앞으로 2주 일정이에요. 수정은 부채·고정지출 탭에서 할 수 있어요.</p>
    ${noPayDay ? '<p class="hint">상환일이 없는 대출이 있어요. 부채에서 매달 상환일을 넣으면 일정과 알림에 나와요.</p>' : ''}`,
    { action: '<a class="link-btn" href="#fixed">고정지출 전체</a>' })}

  </div><div class="col-main">
  ${section('자산 추이', `<div class="panel chart-panel">
      <div class="chart-top">
        <div class="segment" role="tablist" aria-label="기간">${[['day', '일별'], ['month', '월별'], ['year', '연도별']].map(([k, l]) => `<button role="tab" aria-selected="${mode === k}" data-action="trend" data-key="${k}">${l}</button>`).join('')}</div>
        ${tr.points.length > 1 ? `<span class="trend-sum"><span class="hint">${RANGE[mode]}</span> <b class="${tr.change >= 0 ? 'up' : 'down'}">${tr.change >= 0 ? '+' : '−'}${won(Math.abs(tr.change))} (${tr.change >= 0 ? '+' : ''}${pct(tr.rate, 2)})</b></span>` : ''}
      </div>
      ${tr.points.length > 1
        ? `<div class="chart-box"><canvas id="chart-trend" role="img" aria-label="${RANGE[mode]} 총자산 추이"></canvas></div>`
        : `<p class="empty">${tr.points.length ? '기록이 쌓이는 중이에요.' : '아직 기록이 없어요.'} 오늘부터 매일 총자산이 자동으로 기록돼서, 내일부터 그래프로 보여요.</p>`}
      ${tr.points.length ? details('trend-table', '표로 보기', `<div class="table-scroll"><table>
        <thead><tr><th>${{ day: '날짜', month: '월', year: '연도' }[mode]}</th><th>총자산</th><th>${{ day: '전일', month: '전월', year: '전년' }[mode]} 대비</th><th>저축액</th><th>주택</th><th>대출잔액</th></tr></thead>
        <tbody>${tr.points.slice().reverse().map((p) => `<tr${p.est ? ' class="est"' : ''}><th>${p.label}${p.est ? ' <span class="est-tag">추정</span>' : ''}</th><td>${won(p.net)}</td><td class="${p.diff ? (p.diff.net >= 0 ? 'up' : 'down') : ''}">${p.diff ? `${p.diff.net >= 0 ? '+' : '−'}${won(Math.abs(p.diff.net))}` : '-'}</td><td>${p.savings == null ? '-' : won(p.savings)}</td><td>${p.homes == null ? '-' : won(p.homes)}</td><td>${won(p.debts)}</td></tr>`).join('')}</tbody>
      </table></div>`) : ''}
    </div>
    <p class="hint">총자산 = 저축액(주식 포함) + 주택 − 대출잔액. 앱을 열 때와 시세를 받아올 때마다 그날 값으로 기록해요.</p>
    ${mode !== 'day' && tr.points.some((p) => p.est) ? '<p class="hint">점선 구간은 추정이에요. 매일 기록이 없던 달은 입력한 저축·상환·매매 기록으로 그 달 말 값을 거꾸로 계산했고, 주식은 주가 대신 넣어 둔 원금으로 셌어요.</p>' : ''}`)}
  </div></div>`;
}

/** 자산 추이: 매일 기록 + 그 전 달은 입력한 기록으로 거꾸로 계산한 추정 (월별·연도별) */
function trendOf(mode) {
  const est = mode === 'day' ? {} : estimateMonths(state.data, state.market, now());
  return trend(state.history, state.data.snapshots, mode, now(), est);
}

/** 홈 맨 위 '어제 대비': 가장 최근 지난 기록과 비교하고, 무엇 때문에 움직였는지 */
function dayDelta(t) {
  const d = sinceLast(state.history, today(), makeEntry(t));
  if (!d) return '';
  const y = new Date(now().getFullYear(), now().getMonth(), now().getDate() - 1);
  const label = d.prevKey === ymd(y) ? '어제' : `${Number(d.prevKey.slice(5, 7))}월 ${Number(d.prevKey.slice(8))}일`;
  return `<div class="delta ${d.net >= 0 ? 'up' : 'down'}">${d.net >= 0 ? '+' : '−'}${won(Math.abs(d.net))}<span>${label} 대비</span></div>${diffParts(d) ? `<div class="delta-parts">${diffParts(d)}</div>` : ''}`;
}

/** '주식 +70,000원 · 대출 +10,000원' (움직인 것만) */
function diffParts(d) {
  const parts = [['주식', d.stocks], ['저축', d.cash], ['주택', d.homes], ['대출', d.debts]].filter(([, v]) => v);
  return parts.map(([k, v]) => `${k} ${v >= 0 ? '+' : '−'}${won(Math.abs(v))}`).join(' · ');
}

function scheduleRow(u) {
  const hot = ALERT_DAYS[u.type].includes(u.dday) || u.dday === 0;
  return row({
    kind: u.type === 'loan' ? 'debts' : 'fixed', id: u.id,
    title: `<span class="badge ${hot ? 'hot' : ''}">${dday(u.dday)}</span>${esc(u.name)}`,
    meta: [mdw(u.date), u.type === 'loan' ? '대출 상환' : '고정지출', esc(u.account || '')].filter(Boolean).join(' · '),
    value: u.type === 'loan' ? won(u.amount) : wonExact(u.amount),
    readOnly: true, // 홈은 보기만, 수정은 부채·고정지출 탭에서
  });
}

// ───────────────────────── 자산 ─────────────────────────
function viewAssets() {
  const d = state.data;
  const m = state.market;
  const t = currentTotals(d, m);

  const thisYear = String(now().getFullYear());
  const sav = (d.savings || []).map((s) => {
    const recs = (d.records || []).filter((r) => r.targetId === s.id && (r.type === 'saving' || r.type === 'withdraw')).sort((a, b) => b.date.localeCompare(a.date));
    const yearIn = recs.filter((r) => r.date.startsWith(thisYear)).reduce((a, r) => a + (r.type === 'saving' ? 1 : -1) * (Number(r.amount) || 0), 0);
    const hist = recs.length ? details(`acct-${s.id}`, `입출금 내역 ${recs.length}건${yearIn ? ` · ${thisYear}년 ${yearIn >= 0 ? '+' : '−'}${won(Math.abs(yearIn))}` : ''}`, `<div class="list">${recs.slice(0, 12).map((r) => row({
        kind: 'record', id: r.id, action: 'edit-rec',
        title: `<span class="date">${r.date.slice(2).replaceAll('-', '.')}</span>${REC_LABEL[r.type]}`,
        meta: [r.kind, r.applied === false ? '잔액 미반영' : '', esc(r.memo || '')].filter(Boolean).join(' · '),
        value: `<span class="${r.type === 'saving' ? 'up' : 'down'}">${r.type === 'saving' ? '+' : '−'}${won(r.amount)}</span>`,
      })).join('')}${recs.length > 12 ? '<div class="pad"><a class="link-btn" href="#records">기록 탭에서 전체 보기</a></div>' : ''}</div>`) : '';
    return `<div class="stock"><div class="stock-head">
      ${row({
        kind: 'savings', id: s.id, title: esc(s.name),
        meta: [s.kind, s.monthly ? `매달 ${won(s.monthly)}` : '', s.rate ? `연 ${pct(s.rate)}` : ''].filter(Boolean).join(' · '),
        value: won(s.balance),
      })}
      <div class="trade-bar">
        <button class="pill buy" data-action="deposit" data-type="saving" data-id="${esc(s.id)}">입금</button>
        <button class="pill sell" data-action="deposit" data-type="withdraw" data-id="${esc(s.id)}">출금</button>
      </div></div>
      ${hist}
    </div>`;
  }).join('');

  const stk = stockSection(d, m);

  const homes = (d.homes || []).map((h) => {
    const mh = m.homes?.[h.id];
    const auto = h.useAuto !== false;
    const status = !auto ? '직접 입력한 시세' : mh?.estimate ? `${esc(mh.basis || '')} · ${dateTime(mh.checkedAt)}` : '다음 자동 수집 때 반영돼요';
    const extra = [
      mh?.error && auto ? `<p class="warn pad">${esc(mh.error)}</p>` : '',
      mh?.candidates?.length ? `<div class="pad"><p class="hint">이 지역에서 찾은 단지 이름이에요. 맞는 이름을 누르면 바로 바뀌어요.</p><div class="cands">${mh.candidates.map((c) => `<button class="pill" data-action="cand" data-id="${esc(h.id)}" data-name="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : '',
      auto && mh?.monthly?.length > 1 ? `<div class="pad"><div class="eyebrow">실거래가 추이 · 월별 중앙값</div><div class="chart-box small"><canvas id="chart-home-${esc(h.id)}" role="img" aria-label="${esc(h.name)} 실거래가 추이"></canvas></div>
        ${details(`trades-${h.id}`, `최근 거래 ${mh.trades?.length || 0}건`, `<div class="table-scroll"><table><thead><tr><th>계약일</th><th>금액</th><th>층</th><th>면적</th></tr></thead><tbody>${(mh.trades || []).map((x) => `<tr><th>${x.date}</th><td>${won(x.price)}</td><td>${x.floor ?? '-'}</td><td>${x.area}㎡</td></tr>`).join('')}</tbody></table></div>`)}</div>` : '',
    ].join('');
    const val = homeValue(h, m);
    const bought = (Number(h.purchasePrice) || 0) * ((h.share ?? 100) / 100);
    const gain = bought ? val - bought : null;
    return row({
      kind: 'homes', id: h.id, title: esc(h.name),
      meta: [esc(h.aptName || ''), h.area ? `${h.area}㎡` : '', (h.share ?? 100) < 100 ? `지분 ${pct(h.share, 0)}` : '', status, bought ? `구매가 ${won(bought)}${h.purchaseDate ? ` (${ymLabel(h.purchaseDate)})` : ''}` : ''].filter(Boolean).join(' · '),
      value: won(val),
      sub: gain != null ? `<span class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : '−'}${won(Math.abs(gain))} (${gain >= 0 ? '+' : ''}${pct((gain / bought) * 100, 2)})</span>` : '',
    }) + extra;
  }).join('');

  const A = assetsSummary(d, m);
  return `
  <section class="hero m-only">
    <div class="eyebrow">자산 합계 · 저축·현금 + 주식 + 주택</div>
    <div class="hero-num">${won(A.value)}</div>
    <div class="delta ${A.gain >= 0 ? 'up' : 'down'}">${A.gain >= 0 ? '+' : '−'}${won(Math.abs(A.gain))} (${A.gain >= 0 ? '+' : ''}${pct(A.rate, 2)})<span>산 가격 대비</span></div>
  </section>
  <div class="cols"><div class="col-main">
  ${section('저축·현금', state.reorder === 'savings' ? sortList('savings', d.savings, (s) => ({ title: esc(s.name), value: won(s.balance) })) : `<div class="panel list">${sav || empty('예금, 적금, 연금, 보증금 등을 추가해 보세요.')}</div>`, { sum: won(t.savings), action: listActions('savings', (d.savings || []).length) })}
  ${depositSection(d)}
  </div><div class="col-side">
  ${section('주택', `<div class="panel list">${homes || empty('단지명과 전용면적을 넣으면 국토부 실거래가로 시세가 반영돼요.')}</div>`, { sum: won(t.homes), action: addBtn('homes') })}
  ${section('주식', stk, { action: `<span class="head-actions">${refreshBtn(m)}${addBtn('stocks', '새 종목')}</span>` })}
  </div></div>
  ${updateLine(m)}`;
}

/** 고정지출 → 구독: 구독 서비스만 따로 모아 보기 (고정지출 중 분류가 '구독'인 것) */
function subsSection(d, t0) {
  const S = subsSummary(d.fixed, t0);
  const add = '<button class="link-btn" data-action="add-sub">+ 구독 추가</button>';
  if (!S.list.length) return section('구독', `<div class="panel">${empty('넷플릭스, 유튜브 프리미엄, 클라우드처럼 정기 결제하는 서비스를 추가해 보세요. 매달·매년 결제 모두 돼요.')}</div>`, { action: add });
  const rows = S.list.map((f) => `<button class="row ${f.active === false ? 'dim' : ''}" data-action="edit" data-kind="fixed" data-id="${esc(f.id)}">
      <span class="row-main"><span class="row-title">${esc(f.name)}</span><span class="row-meta">${[cycleLabel(f), f.account].filter(Boolean).map(esc).join(' · ')}${f.active === false ? ' · 멈춤' : ''}</span></span>
      <span class="row-side"><span class="row-value">${wonExact(f.amount)}</span><span class="row-meta">${f.next ? `${f.dday === 0 ? '오늘 결제' : `${mdw(f.next)} · D-${f.dday}`}` : '멈춤'}</span></span>
    </button>`).join('');
  return section('구독', `<div class="panel">
      <div class="stats sub-stats">
        <div class="stat"><span class="eyebrow">한 달에</span><span class="stat-num">${wonExact(S.monthly)}</span><span class="stat-sub">매년 결제는 12로 나눠 더했어요</span></div>
        <div class="stat"><span class="eyebrow">1년에</span><span class="stat-num">${wonExact(S.yearly)}</span><span class="stat-sub">구독 ${S.count}개${S.paused ? ` · 멈춤 ${S.paused}개` : ''}</span></div>
      </div>
      <div class="list">${rows}</div>
    </div>`, { sum: `${S.count}개`, action: add });
}

/** 자산 탭 '예·적금': 상품 한눈에 보기 + 해마다 달별 추이 */
function depositSection(d) {
  const deps = d.deposits || [];
  const key = today();
  const acct = (id) => (d.savings || []).find((x) => x.id === id);
  const fmt = (v) => (v ? won(v).replace('원', '') : '');
  if (!deps.length) return section('예·적금', `<div class="panel">${empty('적금·예금 상품을 추가하면 한눈에 정리하고 달마다 얼마나 쌓였는지 보여드려요.')}</div>`, { action: addBtn('deposits') });
  const totals = deps.map((x) => depositTotal(x, d.records, key));
  const sum = totals.reduce((a, v) => a + v, 0);
  const summary = `<div class="table-scroll"><table class="dep-table">
    <thead><tr><th>내용</th><th>종류</th><th>총액</th><th>만기</th><th>연금리</th><th></th></tr></thead>
    <tbody>${deps.map((x, i) => `<tr>
      <th><button class="link-btn dep-name" data-action="edit" data-kind="deposits" data-id="${esc(x.id)}">${esc(x.name)}</button>${acct(x.accountId) ? `<small class="muted sub">${esc(acct(x.accountId).name)} 연결</small>` : ''}</th>
      <td>${esc(x.type || '적금')}</td>
      <td>${won(totals[i])}${x.type === '예금' ? '<small class="muted sub">이자 포함 예상</small>' : ''}</td>
      <td>${x.maturity ? x.maturity.replaceAll('-', '.') : '-'}</td>
      <td>${x.rate ? pct(x.rate) : '-'}</td>
      <td>${x.type !== '예금' && x.accountId && acct(x.accountId) ? `<button class="pill buy" data-action="deposit" data-type="saving" data-id="${esc(x.accountId)}" data-amount="${num0(x.amount)}">납입</button>` : ''}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><th>합계</th><td></td><td>${won(sum)}</td><td colspan="3"></td></tr></tfoot>
  </table></div>`;
  const years = depositYears(deps, key);
  const year = years.includes(state.depYear) ? state.depYear : years.at(-1);
  const t = yearTable(deps, d.records, year, key);
  const monthly = `<div class="dep-year"><div class="mini-head">달별 추이
      <span class="mnav">${years.length > 1 ? `<button class="icon-btn" data-action="dep-year" data-key="${year - 1}" ${year <= years[0] ? 'disabled' : ''} aria-label="이전 해"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>` : ''}<b>${year}년</b>${years.length > 1 ? `<button class="icon-btn" data-action="dep-year" data-key="${year + 1}" ${year >= years.at(-1) ? 'disabled' : ''} aria-label="다음 해"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>` : ''}</span></div>
    <div class="table-scroll"><table class="dep-table dep-months">
      <thead><tr><th>구분</th><th>~${year - 1}</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}월</th>`).join('')}<th>총액</th></tr></thead>
      <tbody>${t.rows.map((r) => `<tr><th>${esc(r.name)}<small class="muted sub">${esc(r.type || '적금')}</small></th><td>${fmt(r.before)}</td>${r.months.map((v) => `<td>${fmt(v)}</td>`).join('')}<td><b>${fmt(r.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td>${fmt(t.total.before)}</td>${t.total.months.map((v) => `<td>${fmt(v)}</td>`).join('')}<td><b>${fmt(t.total.total)}</b></td></tr></tfoot>
    </table></div>
    <p class="hint pad">적금은 연결한 계좌에 넣은 돈, 예금은 맡긴 돈과 다달이 붙는 이자(세전 예상)예요. 총액은 그해 말까지 쌓인 금액이에요.</p></div>`;
  return section('예·적금', `<div class="panel">${summary}${monthly}</div>`, { sum: won(sum), action: addBtn('deposits') });
}
const num0 = (v) => Number(v) || 0;

const MARKETS = [['kr', '국내주식'], ['us', '해외주식'], ['pension', '연금저축']];
const usd = (n, digits = 2) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const signed = (n, f = won) => `${n >= 0 ? '+' : '−'}${f(Math.abs(n))}`;
const tone = (n) => (n >= 0 ? 'up' : 'down');

/** 자산 탭 합계: 저축·현금 + 주식 + 주택, 수익은 산 가격(원화 매입금액·구매가) 대비 */
function assetsSummary(d, m) {
  const savings = (d.savings || []).reduce((a, s) => a + (Number(s.balance) || 0), 0);
  let value = savings;
  let cost = savings; // 저축은 원금 그대로로 봐요
  for (const s of d.stocks || []) {
    if (!(Number(s.qty) > 0)) continue;
    const x = stockDetail(s, m);
    value += x.valueKrw;
    cost += x.costKrw || x.valueKrw;
  }
  for (const h of d.homes || []) {
    const v = homeValue(h, m);
    value += v;
    cost += (Number(h.purchasePrice) || 0) * ((h.share ?? 100) / 100) || v;
  }
  const gain = value - cost;
  return { value, gain, rate: cost ? (gain / cost) * 100 : 0 };
}

/** 대출 잔액과 지난달(월 기록) 대비 줄어든 금액·비율. diff > 0 이면 줄었어요 */
function debtSummary() {
  const value = currentTotals(state.data, state.market).debts;
  const ym = today().slice(0, 7);
  const snaps = state.data.snapshots || {};
  const prevKey = Object.keys(snaps).filter((k) => k < ym && snaps[k]?.debts != null).sort().pop();
  if (!prevKey || !snaps[prevKey].debts) return { value, diff: null };
  const diff = snaps[prevKey].debts - value;
  return { value, prevKey, diff, rate: (diff / snaps[prevKey].debts) * 100 };
}
function debtsTitleSum() {
  const D = debtSummary();
  return `<span class="title-sum"><b>${won(D.value)}</b>${D.diff != null ? `<span class="${D.diff > 0 ? 'down' : 'up'}">${D.diff > 0 ? '−' : '+'}${won(Math.abs(D.diff))} (${D.diff > 0 ? '−' : '+'}${pct(Math.abs(D.rate), 2)}) <small>${ymLabel(D.prevKey)} 대비</small></span>` : ''}</span>`;
}

function assetsTitleSum() {
  const a = assetsSummary(state.data, state.market);
  return `<span class="title-sum"><b>${won(a.value)}</b><span class="${a.gain >= 0 ? 'up' : 'down'}">${a.gain >= 0 ? '+' : '−'}${won(Math.abs(a.gain))} (${a.gain >= 0 ? '+' : ''}${pct(a.rate, 2)})</span></span>`;
}

/** 원화 수익 요약: 평가금액, 원화 매입금액이 있는 종목만으로 수익·수익률 */
function profitOf(rows) {
  const value = rows.reduce((a, { x }) => a + x.valueKrw, 0);
  const known = rows.filter(({ x }) => x.costKrw);
  const cost = known.reduce((a, { x }) => a + x.costKrw, 0);
  const profit = known.reduce((a, { x }) => a + x.valueKrw - x.costKrw, 0);
  return { value, cost, profit, rate: cost ? (profit / cost) * 100 : null, missing: rows.length - known.length };
}
const signedPct = (n, d = 2) => `${n >= 0 ? '+' : ''}${pct(n, d)}`;

/** 주식: 전체 합계 + 국내 / 해외 / 연금저축 묶음 */
function stockSection(d, m) {
  const all = (d.stocks || []).map((s) => ({ s, x: stockDetail(s, m) }));
  const groups = Object.fromEntries(MARKETS.map(([k]) => [k, all.filter(({ s }) => stockMarket(s) === k)]));
  const pin = d.settings?.stockPin;
  // 직접 고른 탭 > 고정한 탭 > 종목이 있는 첫 탭 (데이터가 늦게 들어와도 매번 다시 정해요)
  const tab = state.stockTab || pin || MARKETS.find(([k]) => groups[k].length)?.[0] || 'us';
  state.stockTabShown = tab;
  const sort = d.settings?.stockSort || 'value';
  // 보유 중인 종목 먼저, 그 안에서 보유금액순(큰 것부터) 또는 이름순
  const rowsData = groups[tab].slice().sort((a, b) => (Number(b.s.qty) > 0) - (Number(a.s.qty) > 0)
    || (sort === 'name' ? a.s.name.localeCompare(b.s.name, 'ko') : b.x.valueKrw - a.x.valueKrw));

  // 전체 (세 묶음 합산)
  const T = profitOf(all.filter(({ s }) => Number(s.qty) > 0));
  const realizedAll = realizedKrw(d.stocks);
  const total = all.length ? `<section class="panel stats gap-b">
      <div class="stat"><span class="eyebrow">전체 평가금액</span><span class="stat-num">${won(T.value)}</span></div>
      <div class="stat"><span class="eyebrow">평가 손익</span><span class="stat-num ${T.cost ? tone(T.profit) : ''}">${T.cost ? signed(T.profit) : '-'}</span>${T.rate != null ? `<span class="stat-sub ${tone(T.profit)}">${signedPct(T.rate)}</span>` : ''}</div>
      <div class="stat"><span class="eyebrow">실현 손익</span><span class="stat-num ${realizedAll ? tone(realizedAll) : ''}">${realizedAll ? signed(realizedAll) : '0원'}</span><span class="stat-sub">팔아서 확정된 손익</span></div>
    </section>${T.missing ? `<p class="hint gap-b">원화 매입금액이 없는 종목 ${T.missing}개는 손익 계산에서 빠져 있어요.</p>` : ''}` : '';

  const PIN = '<svg class="pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7"/></svg>';
  const seg = `<div class="stock-tools">
    <div class="segment" role="tablist" aria-label="주식 구분">${MARKETS.map(([k, label]) => `<button role="tab" aria-selected="${k === tab}" data-action="stock-tab" data-key="${k}">${k === pin ? PIN : ''}${label}<small>${groups[k].length}</small></button>`).join('')}</div>
    <div class="tool-row">
      <button class="tool" data-action="stock-pin" aria-pressed="${tab === pin}">${PIN}${tab === pin ? '기본 탭으로 고정됨' : '이 탭을 기본으로'}</button>
      <span class="sort" role="group" aria-label="정렬">${[['value', '보유금액순'], ['name', '이름순']].map(([k, l]) => `<button class="tool" data-action="stock-sort" data-key="${k}" aria-pressed="${sort === k}">${l}</button>`).join('<i>·</i>')}</span>
    </div>
  </div>`;

  const G = profitOf(rowsData.filter(({ s }) => Number(s.qty) > 0));
  const realizedTab = realizedKrw(rowsData.map(({ s }) => s));
  const valUsd = rowsData.reduce((a, { x }) => a + (x.cur === 'USD' ? x.value : 0), 0);
  const fxEff = rowsData.reduce((a, { x }) => a + (x.fxEffect || 0), 0);
  const summary = rowsData.length ? `<section class="panel stats gap">
      <div class="stat"><span class="eyebrow">평가금액</span><span class="stat-num">${won(G.value)}</span>${tab === 'us' ? `<span class="stat-sub">${usd(valUsd)}${rowsData.some(({ x }) => x.fxEstimated) ? ' · 환율 받기 전 (매입 환율로 임시 계산)' : ''}</span>` : ''}</div>
      <div class="stat"><span class="eyebrow">${tab === 'us' ? '원화 손익' : '평가 손익'}</span><span class="stat-num ${G.cost ? tone(G.profit) : ''}">${G.cost ? signed(G.profit) : '-'}</span><span class="stat-sub">${G.cost ? `${signedPct(G.rate)}${tab === 'us' ? ` · 환율 효과 ${signed(fxEff)}` : ''}` : '원화 매입금액을 넣으면 보여요'}${realizedTab ? ` · 실현 ${signed(realizedTab)}` : ''}</span></div>
    </section>` : '';

  const rows = rowsData.map(({ s, x }) => {
    const q = m.stocks?.[normTicker(s.ticker)];
    const held = Number(s.qty) > 0;
    const price = x.cur === 'USD' ? usd(x.price) : wonExact(x.price);
    const avgTxt = s.avgPrice ? `평균 ${s.avgCur === 'USD' ? usd(s.avgPrice) : wonExact(s.avgPrice)}` : '';
    const meta = [esc(s.ticker || ''), `${Number(s.qty || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}주`, avgTxt, `현재 ${price}${q?.price ? '' : ' (수동)'}`, x.buyFx && !x.fxEstimated ? `매입 환율 ${wonExact(x.buyFx)}` : '', x.fxEstimated ? '<span class="warn">환율을 받기 전이라 매입 환율로 계산 중</span>' : '', q?.error ? `<span class="warn">${esc(q.error)}</span>` : ''].filter(Boolean).join(' · ');
    let sub = '';
    if (held && x.cur === 'USD') {
      const parts = [];
      if (x.ret != null) parts.push(`<span class="${tone(x.ret)}">$ ${signedPct(x.ret)}</span>`);
      if (x.retKrw != null) parts.push(`<span class="${tone(x.retKrw)}">₩ ${signedPct(x.retKrw)}</span>`);
      sub = parts.join(' ');
    } else if (held && x.retKrw != null) sub = `<span class="${tone(x.profitKrw)}">${signed(x.profitKrw)} (${signedPct(x.retKrw)})</span>`;
    const fxNote = held && x.fxEffect != null ? `<span class="row-meta">원화 손익 ${signed(x.profitKrw)} = 주가 ${signed(x.priceEffect)} + 환율 ${signed(x.fxEffect)}</span>` : '';
    const trades = s.trades || [];
    const realized = trades.reduce((a, t) => a + (t.realizedKrw || 0), 0);
    const history = trades.length ? details(`tr-${s.id}`, `거래 내역 ${trades.length}건${realized ? ` · 실현 ${signed(realized)}` : ''}`, `<div class="table-scroll"><table>
        <thead><tr><th>날짜</th><th>구분</th><th>수량</th><th>단가</th><th>원화</th><th>실현 손익</th></tr></thead>
        <tbody>${trades.slice().reverse().map((t) => `<tr><th>${t.date.slice(2).replaceAll('-', '.')}</th><td class="${t.type === 'buy' ? 'up' : 'down'}">${t.type === 'buy' ? '매수' : '매도'}</td><td>${Number(t.qty).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}</td><td>${t.cur === 'USD' ? usd(t.price) : wonExact(t.price)}</td><td>${t.krw ? wonExact(t.krw) : '-'}${t.fx ? `<small class="muted sub">환율 ${wonExact(t.fx)}</small>` : ''}</td><td>${t.realizedKrw != null ? `<span class="${tone(t.realizedKrw)}">${signed(t.realizedKrw)}</span>` : '-'}</td></tr>`).join('')}</tbody>
      </table></div><div class="pad"><button class="link-btn" data-action="trade-undo" data-id="${esc(s.id)}">마지막 거래 취소</button></div>`) : '';
    return `<div class="stock ${held ? '' : 'sold'}"><div class="stock-head">
      <button class="row" data-action="edit" data-kind="stocks" data-id="${esc(s.id)}">
        <span class="row-main"><span class="row-title">${esc(s.name)}${held ? '' : ' <span class="badge">전량 매도</span>'}</span><span class="row-meta">${meta}</span>${fxNote}</span>
        <span class="row-side"><span class="row-value">${won(x.valueKrw)}</span>${sub ? `<span class="row-meta">${sub}</span>` : ''}</span>
      </button>
      <div class="trade-bar">
        <button class="pill buy" data-action="trade" data-type="buy" data-id="${esc(s.id)}">매수</button>
        <button class="pill sell" data-action="trade" data-type="sell" data-id="${esc(s.id)}" ${held ? '' : 'disabled'}>매도</button>
      </div></div>
      ${history}
    </div>`;
  }).join('');

  const fxRow = tab === 'us' ? row({
    kind: 'fx', id: 'usd', action: 'fx', cls: 'muted-row', title: '달러 환율',
    value: m.fx?.USD ? wonExact(m.fx.USD) : '입력 필요', sub: m.fxAuto ? `자동 · ${dateTime(m.quotesAt || m.updatedAt)}` : '직접 입력',
  }) : '';
  const emptyText = { kr: '국내 주식 종목을 추가해 보세요.', us: '해외 주식은 평균 매수가를 달러로, 원화 매입금액을 함께 넣으면 환율 효과까지 계산해요.', pension: '연금저축 계좌에서 산 ETF·펀드를 추가해 보세요.' }[tab];
  return `${total}${seg}${summary}<div class="panel list gap">${fxRow}${rows || empty(emptyText)}</div>`;
}

// ───────────────────────── 부채 ─────────────────────────
/** 상환스케줄을 불러온 대출: 잔액·다음 출금·남은 회차를 스케줄 그대로 */
function scheduledLoanRow(l) {
  const sch = l.schedule;
  const t = today();
  const bal = scheduleBalanceAt(sch, t);
  const paid = paidRows(sch, t).length;
  const next = nextScheduled(sch, t);
  const orig = Number(l.original) || sch[0].balance + sch[0].principal;
  const done = orig ? Math.min(100, Math.max(0, ((orig - bal) / orig) * 100)) : 0;
  const toDate = (str) => { const [y, mo, dd] = str.split('-').map(Number); return new Date(y, mo - 1, dd); };
  const ahead = sch.filter((r) => r.date >= t).slice(0, 12);
  const last = sch.at(-1).date;
  return `<div class="loan">
    <button class="row stack" data-action="edit" data-kind="debts" data-id="${esc(l.id)}">
      <span class="row-line"><span class="row-title">${esc(l.name)}</span><span class="row-value">${wonExact(bal)}</span></span>
      <span class="row-meta">${[l.kind, '상환스케줄 적용', l.rate ? `연 ${pct(l.rate, 2)}` : '', `${sch.length}회 중 ${paid}회 납부`, `만기 ${last.slice(0, 4)}년 ${Number(last.slice(5, 7))}월`, l.account ? `출금 ${esc(l.account)}` : ''].filter(Boolean).join(' · ')}</span>
      ${next ? `<span class="row-meta">다음 출금 ${mdw(toDate(next.date))} · ${wonExact(next.payment)} (원금 ${wonExact(next.principal)} · 이자 ${wonExact(next.interest)})</span>` : '<span class="row-meta">모두 갚았어요</span>'}
      <span class="progress" role="progressbar" aria-valuenow="${done.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="상환 진행률"><span style="width:${done}%"></span></span>
      <span class="row-meta">${won(orig)} 중 ${pct(done, 1)} 상환</span>
    </button>
    ${ahead.length ? details(`sch-${l.id}`, `앞으로 ${ahead.length}회차`, `<div class="table-scroll"><table>
      <thead><tr><th>회차</th><th>출금일</th><th>원리금</th><th>원금</th><th>이자</th><th>남은 원금</th></tr></thead>
      <tbody>${ahead.map((r) => `<tr><th>${r.n}</th><td>${r.date.slice(2).replaceAll('-', '.')}</td><td>${r.payment.toLocaleString()}</td><td>${r.principal.toLocaleString()}</td><td>${r.interest.toLocaleString()}</td><td>${r.balance.toLocaleString()}</td></tr>`).join('')}</tbody>
    </table></div>`) : ''}
  </div>`;
}

/** 부채 탭 오른쪽: 올해 갚은 돈과 앞으로 나갈 상환 */
function debtSide(d) {
  const y = String(now().getFullYear());
  const recs = [...(d.records || []), ...scheduleRecords(d, today())].filter((r) => r.type === 'repayment' && r.date.startsWith(`${y}-`));
  const principal = recs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const interest = recs.reduce((a, r) => a + (Number(r.interest) || 0), 0);
  const t = today();
  const toDate = (str) => { const [yy, mm, dd] = str.split('-').map(Number); return new Date(yy, mm - 1, dd); };
  const next = [];
  for (const l of d.debts || []) {
    if (l.schedule?.length) l.schedule.filter((r) => r.date >= t).slice(0, 4).forEach((r) => next.push({ l, date: toDate(r.date), amount: r.payment, n: r.n }));
    else for (const u of upcoming({ debts: [l] }, now(), 62)) next.push({ l, date: u.date, amount: u.amount });
  }
  next.sort((a, b) => a.date - b.date);
  return `${section(`${y}년 상환`, `<section class="panel stats">
      <div class="stat"><span class="eyebrow">갚은 원금</span><span class="stat-num">${won(principal)}</span></div>
      <div class="stat"><span class="eyebrow">낸 이자</span><span class="stat-num">${won(interest)}</span></div>
    </section>`)}
  ${section('앞으로 나갈 상환', `<div class="panel list">${next.slice(0, 6).map((x) => row({
      kind: 'debts', id: x.l.id, title: esc(x.l.name),
      meta: [mdw(x.date), x.n ? `${x.n}회차` : '', esc(x.l.account || '')].filter(Boolean).join(' · '), value: wonExact(x.amount),
      sub: dday(daysBetween(now(), x.date)),
    })).join('') || empty('상환일이나 상환스케줄을 넣으면 여기에 나와요.')}</div>`)}`;
}

function viewDebts() {
  const d = state.data;
  const t = currentTotals(d, state.market);
  const pay = (d.debts || []).reduce((a, l) => a + currentPayment(l), 0);
  const list = (d.debts || []).map((l) => {
    if (l.schedule?.length) return scheduledLoanRow(l);
    const orig = Number(l.original) || 0;
    const done = orig ? Math.min(100, Math.max(0, ((orig - l.balance) / orig) * 100)) : null;
    const g = l.method === 'graduated' ? graduatedInfo(l) : null;
    const next = l.payDay ? nextDue(l.payDay, now()) : null;
    const meta = [
      l.kind, METHOD[l.method] + (l.method === 'grace_annuity' ? ` (${l.graceYears || 1}년)` : ''), `연 ${pct(l.rate, 2)}`, `만기 ${ymLabel(l.maturity)}`,
      l.graceEnd && l.method !== 'grace_annuity' ? `거치 ${ymLabel(l.graceEnd)}까지` : '', l.account ? `출금 ${esc(l.account)}` : '',
    ].filter(Boolean).join(' · ');
    const lines = [
      next ? `다음 상환 ${mdw(next)} · 약 ${won(currentPayment(l))}` : `이번 달 약 ${won(currentPayment(l))} · <span class="warn">상환일 미입력</span>`,
      l.method === 'graduated' ? (g ? `매달 약 ${Math.round(g.step).toLocaleString()}원씩 늘어 마지막 회차 약 ${won(g.last)}` : '<span class="warn">이번 달 원리금을 넣어야 체증식으로 계산해요</span>') : '',
    ].filter(Boolean).map((x) => `<span class="row-meta">${x}</span>`).join('');
    return `<button class="row stack" data-action="edit" data-kind="debts" data-id="${esc(l.id)}">
      <span class="row-line"><span class="row-title">${esc(l.name)}</span><span class="row-value">${wonExact(l.balance)}</span></span>
      <span class="row-meta">${meta}</span>${lines}
      ${done != null ? `<span class="progress" role="progressbar" aria-valuenow="${done.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="상환 진행률"><span style="width:${done}%"></span></span><span class="row-meta">${won(orig)} 중 ${pct(done, 0)} 상환</span>` : ''}
    </button>`;
  }).join('');
  const D = debtSummary();
  return `
  <section class="hero m-only">
    <div class="eyebrow">대출 잔액</div>
    <div class="hero-num">${won(t.debts)}</div>
    ${D.diff != null ? `<div class="delta ${D.diff > 0 ? 'down' : 'up'}">${D.diff > 0 ? '−' : '+'}${won(Math.abs(D.diff))} (${D.diff > 0 ? '−' : '+'}${pct(Math.abs(D.rate), 2)})<span>${ymLabel(D.prevKey)} 대비</span></div>` : ''}
  </section>
  <section class="panel stats">
    <div class="stat"><span class="eyebrow">이번 달 상환 (원금+이자)</span><span class="stat-num">${won(pay)}</span></div>
  </section>
  <div class="cols"><div class="col-main">
  ${section('대출', `<div class="panel list">${list || empty('대출을 추가하면 상환 방식대로 연도별 잔액을 계산하고, 상환일 전에 알려드려요.')}</div>`, { action: addBtn('debts') })}
  </div><div class="col-side">${debtSide(d)}</div></div>`;
}

// ───────────────────────── 고정지출 ─────────────────────────
function viewFixed() {
  const d = state.data;
  const t0 = now();
  const s = fixedSummary(d.fixed, t0);
  const loanPay = (d.debts || []).filter((l) => loanBalance(l) > 0).reduce((a, l) => a + currentPayment(l), 0);
  const nextOne = upcoming({ fixed: d.fixed }, t0, 31)[0];

  // 이번 달 달력 순서: 고정지출 + 상환일이 있는 대출
  const y = t0.getFullYear();
  const mo = t0.getMonth();
  const last = new Date(y, mo + 1, 0).getDate();
  const items = [
    ...(d.fixed || []).filter((f) => f.cycle !== 'yearly' || (Number(f.month) || 1) - 1 === mo)
      .map((f) => ({ kind: 'fixed', id: f.id, name: f.name, day: Number(f.day) || 1, amount: Number(f.amount) || 0, meta: [f.category, f.cycle === 'yearly' ? '매년' : '', f.account].filter(Boolean).join(' · '), off: f.active === false })),
    ...(d.debts || []).map((l) => {
      if (l.schedule?.length) {
        // 이번 달 스케줄 회차 (이미 나갔어도 보여줘요)
        const r = l.schedule.find((x) => x.date.slice(0, 7) === `${y}-${String(mo + 1).padStart(2, '0')}`);
        return r ? { kind: 'debts', id: l.id, name: l.name, day: Number(r.date.slice(8)), amount: r.payment, meta: [`대출 상환 · ${r.n}회차`, l.account].filter(Boolean).join(' · '), loan: true } : null;
      }
      return l.payDay && loanBalance(l) > 0 ? { kind: 'debts', id: l.id, name: l.name, day: Number(l.payDay), amount: currentPayment(l), meta: ['대출 상환', l.account].filter(Boolean).join(' · '), loan: true } : null;
    }).filter(Boolean),
  ].map((x) => ({ ...x, eff: Math.min(x.day, last) })).sort((a, b) => a.eff - b.eff || (a.loan ? -1 : 1));

  const todayNum = t0.getDate();
  const rows = items.map((x) => {
    const passed = x.eff < todayNum;
    const left = x.eff - todayNum;
    return `<button class="row cal ${passed || x.off ? 'dim' : ''}" data-action="edit" data-kind="${x.kind}" data-id="${esc(x.id)}">
      <span class="cal-day">${x.eff}<small>일</small></span>
      <span class="row-main"><span class="row-title">${esc(x.name)}</span><span class="row-meta">${esc(x.meta)}${x.off ? ' · 멈춤' : ''}</span></span>
      <span class="row-side"><span class="row-value">${wonExact(x.amount)}</span><span class="row-meta">${x.off ? '' : passed ? '출금됨' : left === 0 ? '오늘' : `D-${left}`}</span></span>
    </button>`;
  }).join('');

  const maxCat = Math.max(1, ...s.categories.map((c) => c.amount));
  return `
  <div class="summary">
  <section class="hero">
    <div class="eyebrow">매달 고정지출</div>
    <div class="hero-num">${wonExact(s.total)}</div>
    <div class="hero-sub">${s.count}건 · 대출 상환까지 합치면 ${won(s.total + loanPay)}</div>
  </section>
  <section class="panel stats">
    <div class="stat"><span class="eyebrow">${mo + 1}월에 남은 출금</span><span class="stat-num">${wonExact(s.remaining)}</span></div>
    <div class="stat"><span class="eyebrow">다음 출금</span><span class="stat-num">${nextOne ? `${esc(nextOne.name)}` : '-'}</span>${nextOne ? `<span class="stat-sub">${mdw(nextOne.date)} · ${dday(nextOne.dday)}</span>` : ''}</div>
  </section>
  </div>
  <div class="cols"><div class="col-main">
  ${section(`${mo + 1}월 출금 일정`, `<div class="panel list">${rows || empty('휴대폰 요금, 관리비, 보험료처럼 매달 나가는 돈을 추가해 보세요. 출금일 아침 브리핑에 알려드려요.')}</div>`, { action: addBtn('fixed') })}
  ${subsSection(d, t0)}
  </div><div class="col-side">
  ${s.categories.length ? section('분류별', `<div class="panel list">${s.categories.map((c) => `<div class="row static bar-row">
      <span class="row-title">${esc(c.name)}</span>
      <span class="bar"><span style="width:${(c.amount / maxCat) * 100}%"></span></span>
      <span class="row-value">${wonExact(c.amount)}<small>${pct((c.amount / s.total) * 100, 0)}</small></span>
    </div>`).join('')}</div>`) : ''}
  </div></div>`;
}

// ───────────────────────── 기록 ─────────────────────────
/** 기록 탭 월별 묶음이 펼쳐져 있는지: 직접 펼치거나 접은 건 기억하고, 아니면 가장 최근 달만 */
function monthOpen(ym, index) {
  const key = `rec-${ym}`;
  return state.open.has(key) || (index === 0 && !state.open.has(`${key}-closed`));
}

/** [모두 펼치기] / [모두 접기]: 지금 다 펼쳐져 있으면 접기, 아니면 펼치기 */
function monthsToggle(yms) {
  if (yms.length < 2) return '';
  const allOpen = yms.every((ym, i) => monthOpen(ym, i));
  return `<button class="link-btn" data-action="months-all" data-open="${allOpen ? '0' : '1'}" data-yms="${yms.join(',')}">${allOpen ? '모두 접기' : '모두 펼치기'}</button>`;
}

// ───────────────────────── 메모 ─────────────────────────
// 급하게 적어 둘 것들. 맨 위 칸에 쓰고 저장, 누르면 고치기·고정·지우기.
const memoTime = (t) => {
  const d = new Date(t);
  const k = ymd(d);
  const hm = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (k === today()) return hm;
  if (k === ymd(new Date(now().getFullYear(), now().getMonth(), now().getDate() - 1))) return `어제 ${hm}`;
  return d.getFullYear() === now().getFullYear() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};
const memoStamp = (m) => `${dateTime(m.createdAt)} 작성${m.updatedAt && m.updatedAt - m.createdAt > 60_000 ? ` · ${dateTime(m.updatedAt)} 고침` : ''}${m.source === 'shortcut' ? ' · 단축어' : ''}`;

/** 언제 쓴 메모인지 묶기: 오늘 / 어제 / 이번 주 / 이번 달 / 2026년 10월 … */
function memoGroup(t) {
  const d = new Date(t);
  const n = now();
  const t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.floor((t0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return '지난 7일';
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return '이번 달';
  return `${d.getFullYear() === n.getFullYear() ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월`;
}

const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>';
function memoCard(m) {
  const [first, ...rest] = String(m.text || '').split('\n');
  const body = rest.join('\n').trim();
  // 카드 전체를 누르면 고치기, 오른쪽 위 핀을 누르면 '중요'로 맨 위에 (다시 누르면 해제)
  return `<div class="memo${m.pinned ? ' pinned' : ''}" role="button" tabindex="0" data-action="memo-edit" data-id="${esc(m.id)}" data-text="${esc(String(m.text || '').toLowerCase())}">
    <button type="button" class="memo-pin" data-action="memo-pin" data-id="${esc(m.id)}" aria-pressed="${!!m.pinned}" aria-label="${m.pinned ? '중요 해제' : '중요로 맨 위에'}" title="${m.pinned ? '중요 해제' : '중요'}">${PIN_SVG}</button>
    <span class="memo-title">${esc(first)}</span>
    ${body ? `<span class="memo-body">${esc(body)}</span>` : ''}
    <span class="memo-meta">${esc(memoTime(m.createdAt))}</span>
  </div>`;
}

/** 메모 고치기: 새 메모 칸과 같은 모양의 창 */
let memoEditing = null;
function openMemoEditor(m) {
  memoEditing = m;
  $('#memo-edit-text').value = m.text || '';
  $('#memo-edit-stamp').textContent = memoStamp(m);
  $('#memo-editor').showModal();
  if (matchMedia('(hover: hover)').matches) { const t = $('#memo-edit-text'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
}
function saveMemoEdit() {
  const old = memoEditing && state.memos.find((x) => x.id === memoEditing.id);
  const text = $('#memo-edit-text').value.trim();
  if (!text) { toast('내용을 적어 주세요.'); return false; }
  if (!old || old.text === text) return true;
  store.saveMemo({ ...old, text, updatedAt: Date.now() }).catch((e) => toast(`저장하지 못했어요: ${e.message}`));
  return true;
}
function toggleMemoPin(id) {
  const m = state.memos.find((x) => x.id === id);
  if (!m) return;
  store.saveMemo({ ...m, pinned: !m.pinned }).catch((e) => toast(`바꾸지 못했어요: ${e.message}`));
}

function viewMemo() {
  const list = [...(state.memos || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const pinned = list.filter((m) => m.pinned);
  const groups = [];
  for (const m of list.filter((x) => !x.pinned)) {
    const g = memoGroup(m.createdAt);
    if (groups.at(-1)?.name !== g) groups.push({ name: g, items: [] });
    groups.at(-1).items.push(m);
  }
  const block = (name, items) => `<section class="memo-group" data-group><h3>${name}</h3><div class="memo-grid">${items.map(memoCard).join('')}</div></section>`;
  return `
  <form id="memo-add" class="ask-box memo-capture" autocomplete="off">
    <label for="memo-input" class="ask-label">새 메모</label>
    <textarea id="memo-input" rows="3" aria-label="새 메모"></textarea>
    <div class="memo-capture-foot"><span class="hint pc-only">Ctrl+Enter로 저장</span><button class="ask-send" type="submit">저장</button></div>
  </form>
  ${list.length > 5 ? '<input id="memo-search" class="memo-search" type="search" placeholder="메모에서 찾기" aria-label="메모에서 찾기" autocomplete="off">' : ''}
  ${list.length ? `${pinned.length ? block('중요', pinned) : ''}${groups.map((g) => block(g.name, g.items)).join('')}<p class="empty memo-none" hidden>찾는 메모가 없어요.</p>`
    : '<p class="empty memo-empty">아직 메모가 없어요. 떠오른 것을 위 칸에 바로 적어 두세요.</p>'}`;
}

async function addMemo(text, source = 'app') {
  const t = Date.now();
  try {
    await store.saveMemo({ id: `m${t.toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, pinned: false, createdAt: t, updatedAt: t, source });
    return true;
  } catch (e) { toast(`메모를 저장하지 못했어요: ${e.message}`); return false; }
}

function saveMemo(vals) {
  const text = vals.text.trim();
  if (!text) { toast('내용을 적어 주세요.'); return false; }
  const old = state.memos.find((m) => m.id === editing.id);
  if (!old) { addMemo(text); return; }
  if (old.text === text && !!old.pinned === !!vals.pinned) return;
  store.saveMemo({ ...old, text, pinned: !!vals.pinned, updatedAt: old.text === text ? old.updatedAt : Date.now() })
    .catch((e) => toast(`저장하지 못했어요: ${e.message}`));
}

function viewRecords() {
  const d = state.data;
  const recs = [...(d.records || []), ...scheduleRecords(d, today())];
  const nameOf = (r) => (d[r.type === 'repayment' ? 'debts' : 'savings'] || []).find((x) => x.id === r.targetId)?.name || '(삭제된 항목)';
  const yearsAll = yearlySummary(recs);
  const years = [...new Set([String(now().getFullYear()), ...yearsAll.map((y) => y.year)])].sort().reverse();
  const year = state.recYear;
  const ys = yearsAll.find((y) => y.year === year) || { saving: 0, principal: 0, interest: 0 };
  const months = monthlySummary(recs, year);
  const targets = byTarget(recs, year);
  const list = recs.filter((r) => r.date.startsWith(`${year}-`)).sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  for (const r of list) (groups[r.date.slice(0, 7)] ||= []).push(r);
  const cell = (n) => (n ? won(n) : '<span class="muted">–</span>');
  const sumOf = (rs, type) => rs.filter((r) => r.type === type).reduce((a, r) => a + (Number(r.amount) || 0), 0);

  return `
  <div class="actions">
    <button class="btn primary" data-action="add-rec" data-type="saving">입금</button>
    <button class="btn" data-action="add-rec" data-type="withdraw">출금</button>
    <button class="btn" data-action="add-rec" data-type="repayment">상환</button>
  </div>
  <div class="segment" role="tablist" aria-label="연도">${years.map((y) => `<button role="tab" aria-selected="${y === year}" data-action="year" data-year="${y}">${y}</button>`).join('')}</div>
  <section class="panel stats three">
    <div class="stat"><span class="eyebrow">저축 (입금 − 출금)</span><span class="stat-num">${won(ys.saving)}</span>${ys.withdraw ? `<span class="stat-sub">출금 ${won(ys.withdraw)}</span>` : ''}</div>
    <div class="stat"><span class="eyebrow">상환 원금</span><span class="stat-num">${won(ys.principal)}</span></div>
    <div class="stat"><span class="eyebrow">낸 이자</span><span class="stat-num">${won(ys.interest)}</span></div>
  </section>

  <div class="cols"><div class="col-side">
  ${section(`${year}년 월별`, `<div class="panel"><div class="table-scroll"><table>
      <thead><tr><th>월</th><th>저축</th><th>상환 원금</th><th>이자</th></tr></thead>
      <tbody>${months.map((m) => `<tr class="${m.count ? '' : 'dim'}"><th>${m.month}월</th><td>${cell(m.saving)}</td><td>${cell(m.principal)}</td><td>${cell(m.interest)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td>${won(ys.saving)}</td><td>${won(ys.principal)}</td><td>${won(ys.interest)}</td></tr></tfoot>
    </table></div></div>`)}

  ${targets.length ? section(`${year}년 항목별`, `<div class="panel list">${targets.map((x) => `<div class="row static">
      <span class="row-main"><span class="row-title">${esc(nameOf(x))}</span><span class="row-meta">${x.type === 'saving' ? `입출금${x.withdraw ? ` (출금 ${won(x.withdraw)})` : ''}` : '상환'} ${x.count}회</span></span>
      <span class="row-side"><span class="row-value">${won(x.type === 'saving' ? x.saving : x.principal)}</span>${x.interest ? `<span class="row-meta">이자 ${won(x.interest)}</span>` : ''}</span>
    </div>`).join('')}</div>`) : ''}

  ${yearsAll.length ? section('연도별 합계', `<div class="panel"><div class="table-scroll"><table>
      <thead><tr><th>연도</th><th>저축</th><th>상환 원금</th><th>이자</th></tr></thead>
      <tbody>${yearsAll.map((y) => `<tr><th>${y.year}년</th><td>${won(y.saving)}</td><td>${won(y.principal)}</td><td>${won(y.interest)}</td></tr>`).join('')}</tbody>
    </table></div></div>`) : ''}
  </div><div class="col-main">
  ${section(`${year}년 기록`, list.length ? Object.entries(groups).map(([ym, rs], gi) => {
      const key = `rec-${ym}`;
      const isOpen = monthOpen(ym, gi); // 처음에는 가장 최근 달만 펼쳐요
      return `<details class="panel month" data-key="${key}" ${isOpen ? 'open' : ''}>
        <summary><b>${Number(ym.slice(5))}월</b><span>${[`입금 ${won(sumOf(rs, 'saving'))}`, sumOf(rs, 'withdraw') ? `출금 ${won(sumOf(rs, 'withdraw'))}` : '', `상환 ${won(sumOf(rs, 'repayment'))}`].filter(Boolean).join(' · ')}</span></summary>
        <div class="list">${rs.map((r) => row({
          kind: r.auto ? 'debts' : 'record', id: r.auto ? r.targetId : r.id, action: r.auto ? 'edit' : 'edit-rec',
          title: `<span class="date">${Number(r.date.slice(8))}일</span>${esc(nameOf(r))}`,
          meta: [r.kind, r.auto ? '상환스케줄 자동' : '', r.applied === false ? '잔액 미반영' : '', esc(r.memo || '')].filter(Boolean).join(' · '),
          value: `${REC_LABEL[r.type]} ${won(r.amount)}`,
          sub: r.interest ? `이자 ${won(r.interest)}` : '',
        })).join('')}</div>
      </details>`;
    }).join('') : `<div class="panel">${empty('아직 기록이 없어요. 위 버튼이나 자산 탭 계좌의 입금·출금 버튼으로 기록해 보세요.')}</div>`, { sum: `${list.length}건`, action: monthsToggle(Object.keys(groups)) })}


  </div></div>`;
}

// ───────────────────────── 설정 ─────────────────────────
// ───────────────────────── 지금 업데이트 ─────────────────────────
const COOLDOWN = 2 * 60_000;

/** 업데이트 시각 + [지금 업데이트] 버튼 */
/** 자산 탭 맨 아래: 업데이트 시각만 */
function updateLine(m) {
  const times = m.updatedAt || m.quotesAt ? `주가·환율 ${dateTime(m.quotesAt || m.updatedAt)} · 주택 실거래가 ${dateTime(m.updatedAt)} 업데이트` : '아직 받은 시세가 없어요';
  return `<p class="hint update-time">${times}</p>`;
}

/** 주식 제목 옆 '업데이트' (글자 버튼). 요청 뒤 새 값이 올 때까지 '업데이트 중…' */
function refreshBtn(m) {
  const r = state.refresh;
  const waiting = r && Date.now() - r.at < 5 * 60_000 && String(m.quotesAt?.seconds || m.quotesAt) === r.quotesAt;
  return `<button class="link-btn" data-action="refresh" data-kind="quotes" ${waiting ? 'disabled' : ''} title="주가·환율 지금 받아오기">${waiting ? '업데이트 중…' : '업데이트'}</button>`;
}

// ───── 앱을 열 때 알아서 업데이트 ─────
// GitHub 예약 실행은 몇 시간씩 늦거나 건너뛰어서, 앱을 열었을 때 오래된 게 있으면 앱이 대신 요청해요.
const tsMs = (x) => (x?.toMillis ? x.toMillis() : x?.seconds ? x.seconds * 1000 : Number(x) || 0);
function autoRefresh() {
  if (isDemo() || !state.user || !state.marketLoaded || !state.secrets?.githubToken || document.visibilityState !== 'visible') return;
  const repo = repoFromLocation(location);
  const token = state.secrets.githubToken;
  const recently = (key) => Date.now() - Number(localStorage.getItem(key) || 0) < 20 * 60_000; // 실패해도 20분에 한 번만
  const kind = autoRefreshPlan(Date.now(), tsMs(state.marketRaw.quotesAt), tsMs(state.marketRaw.updatedAt));
  if (kind && !recently('chgok-auto-market')) {
    localStorage.setItem('chgok-auto-market', String(Date.now()));
    dispatchWorkflow(repo, token, WORKFLOWS[kind].file).then(() => {
      const q = state.market.quotesAt;
      state.refresh = { at: Date.now(), kind, quotesAt: String(q?.seconds || q) }; // 자산 탭에 '업데이트 중…'
      if (navTab(state.tab) === 'money') render();
    }).catch(() => {});
  }
  // 구글 토큰(일정·할일 넣기용)이 10분 안에 끝나면 미리 새로 받아 둬요
  if (autoLinked() && !freshServerToken(state.secrets?.googleAccess, Date.now() + 10 * 60_000) && renewServerToken()) localStorage.setItem('chgok-auto-agenda', String(Date.now())); // 같은 작업이 일정도 받아요
  // 일정·할일: 자동 동기화를 켰고 1시간 넘게 지났으면
  if (autoLinked() && !gConnected() && Date.now() - (state.agenda?.syncedAt || 0) > 60 * 60_000 && !recently('chgok-auto-agenda')) {
    localStorage.setItem('chgok-auto-agenda', String(Date.now()));
    dispatchWorkflow(repo, token, 'agenda-sync.yml').catch(() => {});
  }
}

async function requestRefresh(kind) {
  if (isDemo()) return toast('체험 모드에서는 실제 업데이트를 실행하지 않아요.');
  const token = state.secrets?.githubToken;
  if (!token) {
    toast('먼저 설정 → 지금 업데이트 버튼에서 GitHub 토큰을 넣어 주세요.');
    location.hash = '#settings';
    return;
  }
  const last = Number(localStorage.getItem('chgok-refresh-at') || 0);
  if (Date.now() - last < COOLDOWN) return toast('방금 요청했어요. 잠시 뒤에 다시 눌러 주세요.');
  try {
    await dispatchWorkflow(repoFromLocation(location), token, WORKFLOWS[kind].file);
    localStorage.setItem('chgok-refresh-at', String(Date.now()));
    const q = state.market.quotesAt;
    state.refresh = { at: Date.now(), kind, quotesAt: String(q?.seconds || q) };
    toast(`${WORKFLOWS[kind].label} 업데이트를 요청했어요. 1분쯤 뒤 저절로 반영돼요.`);
    render();
  } catch (e) {
    toast(e.message);
  }
}

function viewSettings() {
  const p = state.push;
  const vapid = state.data.settings?.vapidKey || '';
  const mine = localStorage.getItem('chgok-push-token');
  const standaloneIOS = /iPhone|iPad/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
  let pushBody;
  if (isDemo()) pushBody = '<p class="hint pad">체험 모드에서는 알림을 켤 수 없어요.</p>';
  else if (!p.loaded) pushBody = '<p class="hint pad">확인 중…</p>';
  else if (!p.supported) pushBody = `<p class="hint pad">${standaloneIOS ? '아이폰·아이패드는 Safari 공유 버튼 → 홈 화면에 추가한 뒤, 그 앱에서 알림을 켤 수 있어요.' : '이 브라우저는 푸시 알림을 지원하지 않아요.'}</p>`;
  else pushBody = `
    ${p.devices.length ? `<div class="list">${p.devices.map((x) => `<div class="row static"><span class="row-main"><span class="row-title">${esc(x.device || '기기')}${x.token === mine ? ' <span class="badge">이 기기</span>' : ''}</span><span class="row-meta">${dateTime(x.addedAt)} 등록</span></span><button class="link-btn" data-action="push-remove" data-token="${esc(x.token)}">해제</button></div>`).join('')}</div>` : ''}
    ${pushCheck(p, mine)}
    ${p.devices.length && state.secrets?.githubToken ? '<div class="pad"><button class="btn" data-action="push-test">알림 시험 보내기 (서버에서 모든 기기로)</button></div>' : ''}
    ${vapid ? `<div class="pad"><button class="btn primary" data-action="push-enable">${p.devices.some((x) => x.token === mine) ? '이 기기 다시 등록' : '이 기기에서 알림 받기'}</button></div>` : ''}
    ${details('vapid', vapid ? '웹 푸시 키 바꾸기' : '처음 한 번: 웹 푸시 키 넣기', `<div class="pad">
      <p class="hint">Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서에서 <b>키 쌍 생성</b> 후 나온 키를 붙여 넣으세요. 공개용 키라 저장해도 안전해요.</p>
      <div class="inline"><input id="vapid" type="text" value="${esc(vapid)}" placeholder="B로 시작하는 긴 키" autocomplete="off"><button class="btn" data-action="vapid-save">저장</button></div>
    </div>`)}`;

  return `
  <div class="cols"><div class="col-main">
  ${section('구글 캘린더·할일', googleSettings())}
  ${section('아이폰 단축어', shortcutPanel())}
  ${section('화면 잠금', lockSettings())}
  ${section('비서 알림', `<div class="panel">
      <p class="pad">매일 오전 7시 30분에 <b>아침 브리핑</b>을 보내 드려요: 오늘 일정, 오늘 마감 할일과 지난 할일, 그리고 <b>오늘이 상환일·출금일인</b> 대출 상환과 고정지출. 앱 화면(PC 알림 카드)에서는 상환 5·3·1일 전, 출금 하루 전부터 미리 보여 드려요.</p>
      ${pushBody}
      ${briefingClock()}
      ${remindClock()}
    </div>`)}
  ${section('비서 개선 목록', `<div class="panel list">${(state.data.assistantMisses || []).length
      ? `${state.data.assistantMisses.map((m, i) => ({ m, i })).reverse().map(({ m, i }) => `<div class="row static"><span class="row-main"><span class="row-title">${esc(m.q)}</span><span class="row-meta">${[m.kind === 'wrong' || m.a ? '엉뚱한 답' : '모른다고 답함', m.want ? `원래 원한 것: ${esc(m.want)}` : '', dateTime(m.at)].filter(Boolean).join(' · ')}</span></span><button class="link-btn" data-action="fb-del" data-i="${i}">지우기</button></div>`).join('')}
        <div class="pad actions"><button class="btn primary" data-action="fb-copy">목록 복사하기</button><button class="btn" data-action="misses-clear">목록 비우기</button></div>
        <p class="hint pad">복사한 내용을 Claude와의 대화에 붙여 넣으면, 이 질문들을 알아듣게 고치고 다시 틀리지 않도록 시험 문제로 저장해 둘게요. 금액은 N으로 가려져요.</p>`
      : empty('비서 답이 엉뚱하면 말풍선 아래 ‘이 답이 맞지 않았나요?’를 눌러 주세요. 모르는 질문도 여기에 저절로 모여요.')}</div>`)}
  ${section('지금 업데이트 버튼', `<div class="panel">
      <p class="pad">자산 탭 주식 제목 옆 <b>업데이트</b>를 누르면 GitHub에서 Run workflow를 누른 것처럼 바로 주가·환율을 받아와요. 처음 한 번 GitHub 토큰을 넣어 주세요.</p>
      ${state.secrets?.githubToken
        ? `<div class="list"><div class="row static"><span class="row-main"><span class="row-title">토큰 저장됨</span><span class="row-meta">${esc(state.secrets.githubToken.slice(0, 15))}… · 이 계정의 모든 기기에서 사용</span></span><button class="link-btn" data-action="token-clear">지우기</button></div></div>
           <div class="pad actions"><button class="btn primary" data-action="refresh" data-kind="quotes">주가·환율 지금 업데이트</button><button class="btn" data-action="refresh" data-kind="full">주택 실거래가까지</button></div>`
        : ''}
      ${details('gh-token-guide', state.secrets?.githubToken ? '토큰 바꾸기' : '처음 한 번: GitHub 토큰 넣기', `<div class="pad">
        <ol class="steps">
          <li>PC에서 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 새 토큰 만들기</a>를 열어요 (Fine-grained token).</li>
          <li><b>Token name</b>: 차곡차곡 업데이트 · <b>Expiration</b>: 1년(또는 원하는 기간)</li>
          <li><b>Repository access</b>: Only select repositories → <b>chgokchgok</b> 하나만</li>
          <li><b>Permissions → Repository permissions → Actions</b>: <b>Read and write</b> (다른 권한은 그대로)</li>
          <li>맨 아래 <b>Generate token</b> → github_pat_ 로 시작하는 토큰을 복사해서 아래에 붙여 넣고 저장</li>
        </ol>
        <p class="hint">토큰은 덕준님 계정에만 저장되고 공개 코드에는 들어가지 않아요. 이 저장소의 업데이트 작업을 실행하는 것밖에 할 수 없어요.</p>
        <div class="inline"><input id="gh-token" type="password" placeholder="github_pat_…" autocomplete="off"><button class="btn" data-action="token-save">저장</button></div>
      </div>`)}
    </div>`)}
  ${section('시세 자동 업데이트', `<div class="panel"><p class="pad">앱을 열 때 시세가 오래됐으면 알아서 새로 받아요. 아침 6시 20분이 지나 처음 열면 미국 주가 마감가·주택 실거래가까지, 평일 장중(9시~3시 50분)에는 주가·환율이 1시간 넘게 지났으면, 장 마감 뒤에는 마감가를 받아요. 1분쯤 뒤 저절로 반영돼요. GitHub 예약 실행도 그대로 두지만 몇 시간씩 늦을 수 있어요.</p><p class="hint pad">주가·환율 ${dateTime(state.market?.quotesAt || state.market?.updatedAt)} · 주택 실거래가 ${dateTime(state.market?.updatedAt)}</p></div>`)}
  </div><div class="col-side">
  ${section('백업', `<div class="panel"><div class="pad actions">
      <button class="btn" data-action="export">백업 파일 받기</button>
      <label class="btn">백업 불러오기<input type="file" accept="application/json" id="import" hidden></label>
    </div></div>`)}
  ${section('계정', `<div class="panel list">
      <div class="row static"><span class="row-main"><span class="row-title">${esc(state.user?.email || '')}</span><span class="row-meta">앱 버전 ${esc(APP_VERSION)} · <a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></span></span><button class="link-btn" data-action="logout">${isDemo() ? '체험 끝내기' : '로그아웃'}</button></div>
    </div>`)}
  </div></div>`;
}

/** 이 기기 알림 점검: 권한·등록 상태와, 서버를 거치지 않고 바로 띄워 보기 */
function pushCheck(p, mine) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const registered = p.devices.some((x) => x.token === mine);
  const PERM = { granted: '허용됨', denied: '차단됨', default: '아직 묻지 않음', unsupported: '지원 안 함' };
  const ok = perm === 'granted' && registered;
  return `<div class="pad push-check">
    <b class="mini-title">이 기기 알림 점검</b>
    <div class="check-line"><span>알림 권한</span><b class="${perm === 'granted' ? 'ok' : 'bad'}">${PERM[perm]}</b></div>
    <div class="check-line"><span>알림 받을 기기로 등록</span><b class="${registered ? 'ok' : 'bad'}">${registered ? '등록됨' : '안 됨'}</b></div>
    <div class="actions"><button class="btn" data-action="push-local">이 기기에서 바로 띄워 보기</button></div>
    <p class="hint">바로 띄운 알림은 보이는데 ‘알림 시험 보내기’는 안 오면 → 위 <b>이 기기 다시 등록</b>을 눌러 주세요. 바로 띄운 알림도 안 보이면 → 기기 설정에서 이 앱(브라우저)의 알림이 꺼져 있거나 방해 금지·집중 모드가 켜져 있어요.${ok ? '' : ' 권한이 허용되고 등록돼야 알림을 받을 수 있어요.'}</p>
  </div>`;
}

async function loadPush() {
  try {
    state.push = { loaded: true, supported: await store.pushSupported(), devices: await store.pushDevices() };
  } catch {
    state.push = { loaded: true, supported: false, devices: [] };
  }
  if (state.tab === 'settings') render();
}

// ───────────────────────── 일정 (구글 캘린더) · 할일 (차곡차곡) ─────────────────────────
// 앱에서 구글에 연결해 받아 온 일정·할일은 Firestore(agenda)에 저장해 둬서, 다음에 열면 연결 없이도 바로 보여요.
const gset = () => state.data.settings?.google || {};
let googleApi = null;
let googleFor = null;
function gapi() {
  if (isDemo()) return (googleApi ||= createDemoGoogle());
  const id = gset().clientId || '';
  if (!id) return null;
  if (id !== googleFor) { googleApi = createGoogle(id, serverGoogleToken); googleFor = id; }
  return googleApi;
}

/**
 * 자동 동기화를 켰으면 서버(GitHub)가 1시간짜리 구글 토큰을 받아 둬요. 그걸 쓰면 일정·할일을 넣을 때 구글 창이 안 떠요.
 * 토큰이 지났으면 새로 받아 달라고 하고, 넣는 중(interactive)이면 1분 남짓 기다려요.
 */
let gTokenAsked = 0;
function renewServerToken() {
  if (isDemo() || !autoLinked() || !state.secrets?.githubToken || Date.now() - gTokenAsked < 3 * 60_000) return false;
  gTokenAsked = Date.now();
  dispatchWorkflow(repoFromLocation(location), state.secrets.githubToken, 'agenda-sync.yml').catch(() => { gTokenAsked = 0; });
  return true;
}
async function serverGoogleToken(interactive) {
  const t = freshServerToken(state.secrets?.googleAccess);
  if (t || !interactive || !autoLinked() || !state.secrets?.githubToken) return t;
  renewServerToken();
  toast('구글 연결을 새로 받는 중이에요. 1분쯤 걸려요.');
  for (let i = 0; i < 60; i++) { // 최대 2분: 서버가 새 토큰을 저장하면 바로 이어서 넣어요
    await new Promise((r) => setTimeout(r, 2000));
    const x = freshServerToken(state.secrets?.googleAccess);
    if (x) return x;
  }
  return null;
}
const gConnected = () => !!gapi()?.connected();

/** 캘린더별 보기·반려자 설정 (설정에서 바꾼 값이 우선) */
const calPref = (c) => calPrefOf(c, gset());
/** 화면에 보여줄 일정 (숨긴 캘린더는 빼고, 반려자 표시는 지금 설정대로) */
const agendaEvents = () => visibleEvents(state.agenda, gset());

/** 대출 상환·고정지출도 일정 화면에 같이 (돈 나가는 날) */
function moneyEvents(days) {
  return upcoming(state.data, now(), days).map((u) => {
    const k = ymd(u.date);
    return { id: `m-${u.type}-${u.id}`, money: true, calName: u.type === 'loan' ? '대출 상환' : '고정지출', color: '', partner: false,
      title: `${u.name} ${u.exact ? wonExact(u.amount) : `약 ${won(u.amount)}`}`, allDay: true, startKey: k, endKey: k, time: '', endTime: '', link: `#${u.type === 'loan' ? 'debts' : 'fixed'}` };
  });
}

let syncing = null;
/** 구글에서 일정·할일 새로 받기. interactive=false면 이미 연결된 경우에만 조용히 */
function syncAgenda(interactive = false) {
  const g = gapi();
  if (!g) { if (interactive) { toast('먼저 설정에서 구글 클라이언트 ID를 넣어 주세요.'); location.hash = '#settings'; } return null; }
  if (!interactive && !g.connected()) return null;
  if (syncing) return syncing;
  state.gsync = 'busy';
  renderGsync();
  syncing = (async () => {
    try {
      state.agenda = keepExternal(await fetchAgenda(g, gset(), now(), interactive), state.agenda); // 네이버 캘린더는 GitHub이 받아 둔 것 그대로
      state.gsync = '';
      saveAgendaSoon(0);
    } catch (e) {
      state.gsync = e.needsAuth ? 'auth' : e.message;
      if (interactive) toast(e.message);
    } finally {
      syncing = null;
      render();
    }
  })();
  return syncing;
}

let agendaTimer;
function saveAgendaSoon(ms = 800) {
  clearTimeout(agendaTimer);
  agendaTimer = setTimeout(() => state.agenda && store.saveAgenda(JSON.parse(JSON.stringify(state.agenda))).catch(() => {}), ms);
}

// ───── 할일: 차곡차곡에 직접 저장 (구글 태스크는 앱에서 시간·반복을 넣을 수 없어서) ─────
const findTask = (id) => state.tasks.find((x) => x.id === id);

/** 할일 하나 저장: 화면에 먼저 보이고, 저장에 실패하면 알려 드려요 */
function putTask(t) {
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) state.tasks[i] = t; else state.tasks.unshift(t);
  render();
  return store.saveTask(JSON.parse(JSON.stringify(t))).then(() => true, (e) => { toast(`저장하지 못했어요: ${e.message}`); return false; });
}

/** 입력칸의 글로 할일 넣기: '매주 월, 목요일 오후 9시 귀 세척', '금요일까지 보고서' */
function addTask(text) {
  const { title, due, repeat, time } = parseQuickTask(text, now());
  if (!title) return false;
  addTaskItem(title, due, { time, repeat });
  return true;
}

/** 할일 미리보기 한 줄 */
function taskPreview(text) {
  const { title, due, repeat, time } = parseQuickTask(text, now());
  if (!title) return ENTER_HINT;
  return `‘${title}’ · ${due ? `${dueLabel(due, today())}${time ? ` ${time}` : ''}${due <= today() || repeat ? '' : '까지'}` : time ? `${time}` : '날짜 없음'}${repeat ? ` · ${repeatLabel(repeat, due)}` : ''}${time ? ' · 30분 전 알림' : ''}`;
}

async function addTaskItem(title, due, { time = '', repeat = null, notes = '' } = {}, quiet = false) {
  const t = makeTask({ title, due, time, repeat, notes });
  const ok = await putTask(t);
  if (ok && !quiet) toast(`‘${title}’${due ? ` · ${dueLabel(due, today())}${time ? ` ${time}` : ''}` : ''}${repeat ? ` · ${repeatLabel(repeat, due)}` : ''} 추가했어요.`);
  return ok;
}

/** 완료·완료 취소. 반복 할일을 끝내면 다음 차례를 만들어요 */
function toggleTask(id) {
  const t = findTask(id);
  if (!t) return;
  const done = !t.done;
  state.justToggled = done ? id : '';
  setTimeout(() => { state.justToggled = ''; }, 0);
  putTask({ ...t, done, completedAt: done ? today() : '', updatedAt: Date.now() });
  if (done && t.repeat) {
    const next = nextRepeatTask(t, state.tasks, today());
    if (next) { putTask(next); toast(`잘했어요! 다음 차례 ${mdw(fromKey(next.due))} 할일을 만들어 뒀어요.`); }
  }
}

function saveTask(vals) {
  const id = editing.id;
  const due = vals.due || '';
  const repeat = vals.repeat ? ruleFromChoice(vals.repeat, due || today(), editing.rule) : null;
  if (repeat && !due) { toast('반복 할일은 날짜가 있어야 해요.'); return false; }
  if (!id) { addTaskItem(vals.title, due, { time: vals.time || '', repeat, notes: vals.notes || '' }); return; }
  const old = findTask(id);
  if (!old) return;
  putTask({ ...old, title: vals.title, due, time: vals.time || '', notes: vals.notes || '', repeat, series: repeat ? old.series || old.id : '', updatedAt: Date.now() });
}

function removeTask(id) {
  state.tasks = state.tasks.filter((x) => x.id !== id);
  render();
  store.deleteTask(id).catch((e) => toast(`지우지 못했어요: ${e.message}`));
}

// ───── 일정 넣기·고치기·지우기 (구글 캘린더에 바로) ─────
const writableCals = () => (state.agenda?.calendars || []).filter((c) => c.write !== false && !/holiday|공휴일|#contacts|#weather/i.test(c.id));
const canWrite = (calId) => writableCals().some((c) => c.id === calId);
/** 내용을 보고 고른 캘린더 (없으면 기본 캘린더) */
function defaultCal(title, calName = '') {
  const want = (calName || (gset().keywords || []).find((k) => k.word && (title || '').includes(k.word))?.cal || classifyEvent(title || '')).toLowerCase();
  const cals = writableCals();
  return cals.find((c) => c.name.toLowerCase() === want) || cals.find((c) => c.name.toLowerCase() === 'life') || cals.find((c) => c.primary) || cals[0];
}
function eventPreview(p) {
  if (!p.title) return ENTER_HINT;
  const cal = defaultCal(p.title, p.calName);
  return `‘${p.title}’ · ${eventLine({ ...p, date: p.date || today() }).replace(` ${p.title}`, '')}${p.date ? '' : ' (날짜를 안 써서 오늘)'}${p.repeat ? ` · ${repeatLabel(p.repeat, p.date)}` : ''}${p.location ? ` · ${p.location}` : ''}${cal ? ` · ${cal.name}` : ''}`;
}
const appEvent = (r, cal) => normEvent(r, { id: cal.id, summary: cal.name, backgroundColor: cal.color, partner: calPref(cal).partner });

/** 화면에 먼저 반영하고 구글에 보내요. 실패하면 되돌려요. 성공하면 true */
async function eventOp(change, call) {
  const g = gapi();
  if (!g || !state.agenda) { toast('먼저 설정에서 구글에 연결해 주세요.'); return false; }
  const before = JSON.stringify(state.agenda.events);
  change(state.agenda.events);
  render();
  try {
    await call(g);
    saveAgendaSoon();
    render();
    return true;
  } catch (e) {
    state.agenda.events = JSON.parse(before);
    if (e.needsAuth) state.gsync = 'auth';
    render();
    toast(`구글 캘린더에 반영하지 못했어요: ${e.message}`);
    return false;
  }
}

/** ev: {title, date, endDate, allDay, time, endTime, location, calId} */
async function createEvent(ev) {
  const cal = writableCals().find((c) => c.id === ev.calId) || defaultCal(ev.title);
  if (!cal) { toast('일정을 넣을 수 있는 캘린더가 없어요. 설정에서 구글 연결을 확인해 주세요.'); return false; }
  const tmp = { id: `tmp-${Date.now()}`, calId: cal.id, calName: cal.name, color: cal.color, partner: false, title: ev.title, location: ev.location || '',
    allDay: !!ev.allDay, startKey: ev.date, endKey: ev.endDate || ev.date, time: ev.allDay ? '' : ev.time, endTime: ev.allDay ? '' : ev.endTime, link: '' };
  const ok = await eventOp((evs) => evs.push(tmp), async (g) => {
    const r = await g.addEvent(cal.id, toGoogleEvent(ev));
    const i = state.agenda.events.findIndex((x) => x.id === tmp.id);
    if (i >= 0) state.agenda.events[i] = appEvent(r, cal);
  });
  if (ok) toast(`${cal.name}에 넣었어요: ${eventLine(ev)}${ev.repeat ? ` · ${repeatLabel(ev.repeat, ev.date)}` : ''}${calPref(cal).show ? '' : ' (설정에서 숨긴 캘린더예요)'}`);
  // 반복 일정은 다음 차례들까지 구글에서 다시 받아 와요
  if (ok && ev.repeat) { if (gConnected()) syncAgenda(false); else if (autoLinked()) requestAgendaSync(); }
  return ok;
}

function saveEvent(vals) {
  const ev = { ...vals, allDay: vals.allDay !== 'time', endDate: vals.allDay === 'time' ? '' : vals.endDate, repeat: undefined };
  if (!ev.allDay && !ev.time) { toast('시작 시간을 넣어 주세요.'); return false; }
  if (!editing.id) { createEvent({ ...ev, repeat: vals.repeat ? ruleFromChoice(vals.repeat, ev.date, editing.rule) : null }); return; }
  const { id, calId: oldCal } = editing;
  const cal = writableCals().find((c) => c.id === ev.calId) || writableCals().find((c) => c.id === oldCal);
  const body = toGoogleEvent(ev);
  eventOp((evs) => {
    const e = evs.find((x) => x.id === id && x.calId === oldCal);
    if (e) Object.assign(e, { title: ev.title, location: ev.location, allDay: ev.allDay, startKey: ev.date, endKey: ev.endDate || ev.date, time: ev.allDay ? '' : ev.time, endTime: ev.allDay ? '' : ev.endTime, calId: cal.id, calName: cal.name, color: cal.color });
  }, async (g) => {
    let r;
    if (cal.id === oldCal) r = await g.patchEvent(oldCal, id, body);
    else { r = await g.addEvent(cal.id, body); await g.deleteEvent(oldCal, id); } // 다른 캘린더로 옮기기
    const i = state.agenda.events.findIndex((x) => x.id === id && x.calId === cal.id);
    if (i >= 0) state.agenda.events[i] = appEvent(r, cal);
  });
}

/** 비서가 옮기기: a = {calId, id, to: {date, endDate, allDay, time, endTime}} */
function moveEvent(a) {
  const e = state.agenda?.events.find((x) => x.id === a.id && x.calId === a.calId);
  const cal = writableCals().find((c) => c.id === a.calId);
  if (!e || !cal) { toast('그 일정을 찾지 못했어요. 새로고침 후 다시 해 주세요.'); return false; }
  const ev = { title: e.title, ...a.to, endDate: a.to.endDate || '' };
  return eventOp((evs) => {
    const x = evs.find((y) => y.id === a.id && y.calId === a.calId);
    if (x) Object.assign(x, { allDay: ev.allDay, startKey: ev.date, endKey: ev.endDate || ev.date, time: ev.allDay ? '' : ev.time, endTime: ev.allDay ? '' : ev.endTime });
  }, async (g) => {
    const r = await g.patchEvent(a.calId, a.id, toGoogleEvent(ev));
    const i = state.agenda.events.findIndex((y) => y.id === a.id && y.calId === a.calId);
    if (i >= 0) state.agenda.events[i] = appEvent(r, cal);
  });
}

function removeEvent(calId, id) {
  return eventOp((evs) => evs.splice(evs.findIndex((x) => x.id === id && x.calId === calId), 1), (g) => g.deleteEvent(calId, id));
}

// ───── 자동 동기화 (GitHub이 1시간마다 구글에서 받아 둬요) ─────
const autoLinked = () => !!state.secrets?.googleRefresh;
let agendaAsked = 0;
async function requestAgendaSync() {
  if (Date.now() - agendaAsked < 60_000) return toast('방금 요청했어요. 1~2분 뒤 저절로 반영돼요.');
  try {
    await dispatchWorkflow(repoFromLocation(location), state.secrets?.githubToken, 'agenda-sync.yml');
    agendaAsked = Date.now();
    toast('새로 받아 달라고 요청했어요. 1~2분 뒤 저절로 반영돼요.');
  } catch (e) { toast(e.message); }
}

async function turnOnAutoSync(btn) {
  if (!state.secrets?.githubToken) return toast('먼저 아래 ‘지금 업데이트 버튼’에서 GitHub 토큰을 넣어 주세요.');
  btn.disabled = true;
  try {
    const code = await gapi().requestCode(); // 구글 허용 창
    await store.saveSecret('googleAuthCode', code);
    await store.saveSecret('googleLinkError', '');
    await dispatchWorkflow(repoFromLocation(location), state.secrets.githubToken, 'agenda-sync.yml');
    toast('연결하는 중이에요. 1~2분 뒤 ‘켜짐’으로 바뀌어요.');
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

function autoSyncPanel() {
  const sc = state.secrets || {};
  const err = sc.googleLinkError ? `<p class="pad warn">${esc(sc.googleLinkError)}</p>` : '';
  if (autoLinked()) {
    return `<div class="row static"><span class="row-main"><span class="row-title">자동 동기화 켜짐</span><span class="row-meta">앱을 안 열어도 오전 6시~밤 11시에 1시간마다, 그리고 아침 브리핑 직전에 새로 받아요${sc.googleSyncedAt ? ` · 마지막 ${dateTime(sc.googleSyncedAt)}` : ''}</span></span><button class="link-btn" data-action="g-auto-off">끄기</button></div>
      ${err}<div class="pad actions"><button class="btn" data-action="g-auto-now">지금 새로 받기 (GitHub)</button></div>`;
  }
  if (sc.googleAuthCode && !sc.googleLinkError) return '<p class="pad">자동 동기화를 연결하는 중이에요. 1~2분 걸려요.</p>';
  return `${err}${details('g-auto', '자동 동기화 켜기 (앱을 안 열어도 최신 일정·할일)', `<div class="pad">
    <p class="hint">켜 두면 GitHub이 1시간마다 구글에서 일정·할일을 받아 둬요. 아침 브리핑과 비서가 늘 최신 내용으로 답하고, 앱에서도 구글 연결 없이 최신 일정이 보여요. 처음 한 번만 해 주세요.</p>
    <ol class="steps">
      <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">구글 콘솔 → 사용자 인증 정보</a>에서 만들어 둔 <b>OAuth 클라이언트</b>(웹 애플리케이션)를 눌러요.</li>
      <li>오른쪽 <b>클라이언트 보안 비밀번호</b>를 복사해요. 안 보이면 <b>Add secret</b>(보안 비밀번호 추가)을 눌러 새로 만들어요.</li>
      <li><a href="https://github.com/${repoFromLocation(location).owner}/${repoFromLocation(location).repo}/settings/secrets/actions/new" target="_blank" rel="noopener">GitHub 새 Secret 만들기</a>를 열어 Name에 <b>GOOGLE_CLIENT_SECRET</b>, Secret에 복사한 값을 넣고 Add secret.</li>
      <li>아래 <b>자동 동기화 켜기</b>를 누르고 구글 화면에서 허용해요.</li>
    </ol>
    <p class="hint">보안 비밀번호는 GitHub Secrets에만 들어가고 공개 코드나 앱에는 들어가지 않아요. 앱 안 업데이트 버튼에 쓰는 GitHub 토큰이 필요해요${state.secrets?.githubToken ? ' (저장돼 있어요)' : ' (아래 ‘지금 업데이트 버튼’에서 먼저 넣어 주세요)'}.</p>
    <button class="btn primary" data-action="g-auto-on">자동 동기화 켜기</button>
  </div>`)}`;
}

/** 아침 브리핑을 8시 정각에: GitHub 예약은 몇 시간씩 늦어서 외부 알람(cron-job.org)이 깨워요 */
function briefingClock() {
  const { owner, repo } = repoFromLocation(location);
  const code = (label, value, copy) => `<div class="sc-row"><span class="sc-label">${label}</span><code>${esc(value)}</code>${copy ? `<button class="link-btn" data-action="sc-copy" data-what="${copy}">복사</button>` : ''}</div>`;
  return details('brief-clock', '아침 브리핑 7시 30분 정각에 받기 (처음 한 번, 5분)', `<div class="pad">
    <p class="hint">GitHub 무료 예약 실행은 붐비는 시간에 몇 시간씩 늦거나 건너뛰어요. 그래서 무료 알람 서비스가 매일 7시 30분에 GitHub을 깨우게 해요. 같은 날 두 번 오지 않고, GitHub 예약이 늦게(10시 30분 넘어) 돌면 보내지 않아요.</p>
    <ol class="steps">
      <li><a href="https://cron-job.org/en/signup/" target="_blank" rel="noopener">cron-job.org</a>에 무료로 가입하고 로그인해요.</li>
      <li>오른쪽 위 계정 메뉴 → <b>Settings</b> → <b>Timezone</b>을 <code>Asia/Seoul</code>로 바꾸고 저장해요.</li>
      <li><b>Dashboard</b> → <b>CREATE CRONJOB</b>
        <br>Title: <code>차곡차곡 아침 브리핑</code> · URL: 아래 ① · Execution schedule: <b>Every day at 7 : 30</b></li>
      <li>같은 화면 <b>ADVANCED</b> 탭: Request method <b>POST</b>, Request body는 아래 ③, Headers 세 개:
        <br><code>Authorization</code> = <code>Bearer </code>+ ②, <code>Accept</code> = <code>application/vnd.github+json</code>, <code>Content-Type</code> = <code>application/json</code></li>
      <li><b>CREATE</b>로 저장해요. <b>TEST RUN</b>을 눌러 결과가 <b>204</b>이고 1분쯤 뒤 브리핑 알림이 오면 끝이에요. (시험으로 보낸 날은 그날 아침 브리핑으로 쳐요)</li>
    </ol>
    <div class="sc-codes">
      ${code('①', `https://api.github.com/repos/${owner}/${repo}/actions/workflows/notify.yml/dispatches`, 'notify-url')}
      ${code('②', state.secrets?.githubToken ? 'GitHub 토큰 (저장된 것)' : '아래 ‘지금 업데이트 버튼’에서 먼저 넣어 주세요', state.secrets?.githubToken ? 'gh-token' : '')}
      ${code('③', '{"ref":"main"}', 'ref-body')}
    </div>
    <p class="hint">GitHub 토큰은 이 저장소의 작업 실행 권한만 있어요. 그만 쓰려면 cron-job.org에서 이 알람을 지우면 돼요.</p>
  </div>`);
}

/** 할일·일정 30분 전 알림: cron-job.org가 5분마다 GitHub을 깨워요 */
function remindClock() {
  const { owner, repo } = repoFromLocation(location);
  const code = (label, value, copy) => `<div class="sc-row"><span class="sc-label">${label}</span><code>${esc(value)}</code>${copy ? `<button class="link-btn" data-action="sc-copy" data-what="${copy}">복사</button>` : ''}</div>`;
  return details('remind-clock', '할일·일정 30분 전 알림 받기 (처음 한 번, 3분)', `<div class="pad">
    <p class="hint">시간을 넣은 할일과 구글 캘린더 일정(반려자·종일 일정 빼고)을 시작 30분 전에 한 번 알려 드려요. 5분마다 확인해서 몇 분 차이가 날 수 있어요. 아침 브리핑 알람을 만든 것과 같은 방법이에요.</p>
    <ol class="steps">
      <li><a href="https://cron-job.org/" target="_blank" rel="noopener">cron-job.org</a> → <b>Dashboard</b> → <b>CREATE CRONJOB</b>
        <br>Title: <code>차곡차곡 30분 전 알림</code> · URL: 아래 ① · Execution schedule: <b>Every 5 minutes</b></li>
      <li><b>ADVANCED</b> 탭: Request method <b>POST</b>, Request body는 아래 ③, Headers 세 개:
        <br><code>Authorization</code> = <code>Bearer </code>+ ②, <code>Accept</code> = <code>application/vnd.github+json</code>, <code>Content-Type</code> = <code>application/json</code></li>
      <li>맨 아래 <b>CREATE</b>를 꼭 눌러 저장해요. Dashboard 목록에 생기면 끝이에요.</li>
    </ol>
    <div class="sc-codes">
      ${code('①', `https://api.github.com/repos/${owner}/${repo}/actions/workflows/remind.yml/dispatches`, 'remind-url')}
      ${code('②', state.secrets?.githubToken ? 'GitHub 토큰 (저장된 것)' : '아래 ‘지금 업데이트 버튼’에서 먼저 넣어 주세요', state.secrets?.githubToken ? 'gh-token' : '')}
      ${code('③', '{"ref":"main"}', 'ref-body')}
    </div>
  </div>`);
}

/** 아이폰 단축어: 일정·할일·메모를 앱을 열지 않고 넣기 */
function shortcutPanel() {
  const { owner, repo } = repoFromLocation(location);
  const code = (label, value, copy) => `<div class="sc-row"><span class="sc-label">${label}</span><code>${esc(value)}</code>${copy ? `<button class="link-btn" data-action="sc-copy" data-what="${copy}">복사</button>` : ''}</div>`;
  const ready = autoLinked() && state.secrets?.githubToken;
  return `<div class="panel"><p class="pad">단축어나 시리로 ‘일정 · 할일 · 메모’를 고르고 말하면, 앱을 열지 않아도 30초~1분 뒤 구글 캘린더·태스크와 메모에 들어가고 휴대폰 알림으로 알려드려요.</p>
    ${ready ? '' : `<p class="pad warn">먼저 ${autoLinked() ? '' : '위의 <b>자동 동기화</b>와 '}아래 <b>지금 업데이트 버튼</b>의 GitHub 토큰을 준비해 주세요.</p>`}
    ${details('sc-guide', '단축어 만들기 (처음 한 번, 아이폰에서)', `<div class="pad">
      <p class="hint">말한 내용은 덕준님만 읽을 수 있는 Firestore 받은편지함에 먼저 넣고, GitHub에는 ‘처리해 줘’ 신호만 보내요. 저장소가 공개라서 내용이 공개 기록에 남지 않게 하려는 거예요.</p>
      <ol class="steps">
        <li>단축어 앱 → <b>+</b> → 이름을 <b>차곡차곡에 추가</b>로 해요. (시리에게 이 이름으로 부를 수 있어요)</li>
        <li><b>목록</b> 동작을 넣고 항목을 <b>일정</b>, <b>할일</b>, <b>메모</b> 세 개로 적어요. 🗓️ ☑️ 📝 이모지로만 적어도 알아들어요. 이어서 <b>목록에서 선택</b>을 넣어요.</li>
        <li><b>입력 요청</b> (텍스트) → 질문: ‘무엇을 넣을까요?’</li>
        <li><b>URL의 콘텐츠 가져오기</b> → URL은 아래 ①, 방법 <b>POST</b>, 요청 본문 <b>양식</b>: <code>grant_type</code> = <code>refresh_token</code>, <code>refresh_token</code> = 아래 ②(단축어 키)</li>
        <li><b>사전 값 가져오기</b> 두 번: 위 결과에서 <code>id_token</code>, <code>user_id</code></li>
        <li><b>URL의 콘텐츠 가져오기</b> → URL은 ③에서 <code>[user_id]</code> 자리에 5번의 user_id 변수를 넣어요. 방법 <b>POST</b>, 헤더 <code>Authorization</code> = <code>Bearer </code>+ id_token 변수. 요청 본문 <b>JSON</b>: <code>fields</code>(사전) 안에 <code>kind</code>(사전: <code>stringValue</code> = 선택한 항목), <code>text</code>(사전: <code>stringValue</code> = 입력한 텍스트)</li>
        <li><b>URL의 콘텐츠 가져오기</b> → URL은 ④, 방법 <b>POST</b>, 헤더 <code>Authorization</code> = <code>Bearer </code>+ ⑤(GitHub 토큰), <code>Accept</code> = <code>application/vnd.github+json</code>. 요청 본문 <b>JSON</b>: <code>ref</code> = <code>main</code></li>
        <li><b>알림 보기</b> → ‘보냈어요’. 끝이에요.</li>
      </ol>
      <div class="sc-codes">
        ${code('①', `https://securetoken.googleapis.com/v1/token?key=${store.apiKey}`, 'token-url')}
        ${code('②', '단축어 키 (로그인 유지 토큰, 길어요)', 'key')}
        ${code('③', 'https://firestore.googleapis.com/v1/projects/chgokchgok/databases/(default)/documents/users/[user_id]/inbox', 'inbox-url')}
        ${code('④', `https://api.github.com/repos/${owner}/${repo}/actions/workflows/agenda-sync.yml/dispatches`, 'gh-url')}
        ${code('⑤', state.secrets?.githubToken ? 'GitHub 토큰 (저장된 것)' : '아래 ‘지금 업데이트 버튼’에서 먼저 넣어 주세요', state.secrets?.githubToken ? 'gh-token' : '')}
      </div>
      <p class="hint">단축어 키와 GitHub 토큰은 이 아이폰 단축어 안에만 두세요. 비밀번호를 바꾸면 단축어 키가 바뀌니 ②를 다시 복사해 넣으면 돼요. 일정은 말한 캘린더 이름(‘라이프에 …’) → 나만의 낱말 → 기본 규칙 순서로 캘린더를 골라요.</p>
    </div>`)}
  </div>`;
}

/** 나만의 낱말: '라스런' → Life 처럼, 이 낱말이 들어간 일정은 정한 캘린더로 */
function keywordPanel() {
  const list = gset().keywords || [];
  const cals = writableCals();
  if (!cals.length) return '';
  return details('g-keywords', `나만의 낱말 ${list.length ? `${list.length}개` : ''}`, `<div class="pad">
    <p class="hint">일정 제목에 이 낱말이 있으면 정한 캘린더로 넣어요. 빠른 입력·비서·단축어 모두 같아요. 말할 때 ‘라이프에 …’처럼 캘린더 이름을 붙이면 그게 가장 먼저예요.</p>
    ${list.length ? `<div class="cal-prefs kw-list">${list.map((k, i) => `<div class="cal-pref"><span><b>${esc(k.word)}</b> → ${esc(k.cal)}</span><button class="link-btn" data-action="kw-del" data-i="${i}">지우기</button></div>`).join('')}</div>` : ''}
    <div class="inline kw-add"><input id="kw-word" type="text" placeholder="낱말" autocomplete="off"><select id="kw-cal" class="select">${cals.map((c) => `<option>${esc(c.name)}</option>`).join('')}</select><button class="btn" data-action="kw-add">추가</button></div>
  </div>`);
}

/** 반려자 네이버 캘린더 (GitHub 자동 동기화가 CalDAV로 읽어 와요) */
function naverPanel() {
  const nv = state.agenda?.naver;
  const cals = (state.agenda?.calendars || []).filter((c) => c.ext === 'naver');
  const status = nv?.error
    ? `<p class="pad warn">네이버 캘린더를 받지 못했어요: ${esc(nv.error)} (${dateTime(nv.at)})</p>`
    : nv ? `<div class="row static"><span class="row-main"><span class="row-title">네이버 캘린더 연결됨</span><span class="row-meta">${cals.map((c) => esc(c.name)).join(', ') || '캘린더 없음'} · 일정 ${nv.count}개 · ${dateTime(nv.at)}</span></span></div>
      ${nv.debug?.length ? details('naver-debug', '진단 정보 (일정이 안 보이면 캡처해서 Claude에게 보여 주세요)', `<div class="pad"><pre class="debug">${esc(nv.debug.map((d) => Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(' · ')).join('\n\n'))}</pre></div>`) : ''}` : '';
  return `${status}${details('naver-guide', nv && !nv.error ? '네이버 캘린더 설정 다시 보기' : '반려자 네이버 캘린더 연결 (읽기만)', `<div class="pad">
    <p class="hint">GitHub 자동 동기화가 1시간마다 반려자분의 네이버 캘린더를 읽어 와서, 반려자 일정으로 하루 맨 뒤에 보여줘요. 네이버 캘린더를 바꾸지는 않아요. 자동 동기화가 켜져 있어야 해요.</p>
    <ol class="steps">
      <li><b>반려자분 휴대폰·PC</b>에서 <a href="https://nid.naver.com" target="_blank" rel="noopener">네이버 내정보</a> → 보안설정을 열어 <b>2단계 인증</b>을 켜요 (이미 켜져 있으면 건너뛰기).</li>
      <li>같은 화면의 <b>애플리케이션 비밀번호 관리</b>에서 종류를 <b>직접 입력 → 차곡차곡</b>으로 하고 <b>생성</b>을 눌러요. 나온 비밀번호(영문 12자리)를 적어 둬요.</li>
      <li><a href="https://github.com/${repoFromLocation(location).owner}/${repoFromLocation(location).repo}/settings/secrets/actions/new" target="_blank" rel="noopener">GitHub 새 Secret</a>을 두 개 만들어요: <b>NAVER_CALDAV_ID</b> = 반려자분 네이버 아이디(@naver.com 빼고), <b>NAVER_CALDAV_PASSWORD</b> = 2번의 애플리케이션 비밀번호.</li>
      <li>위의 <b>지금 새로 받기 (GitHub)</b>를 누르고 1~2분 기다려요. 네이버 캘린더가 ‘보여줄 캘린더’ 목록에 ‘(네이버)’로 생기고, 반려자로 체크돼 있어요.</li>
    </ol>
    <p class="hint">비밀번호는 GitHub Secrets에만 들어가요. 반려자분이 네이버 보안설정에서 그 애플리케이션 비밀번호를 지우면 언제든 연결이 끊겨요.</p>
  </div>`)}`;
}

/** 구글 연결 상태 한 줄 (일정·할일 화면 위) */
function gsyncLine() {
  const a = state.agenda;
  const s = state.gsync;
  const when = a?.syncedAt ? `${dateTime(a.syncedAt)} 기준` : '';
  if (s === 'busy') return `<span class="gsync">불러오는 중…</span>`;
  // 자동 동기화가 켜져 있으면 구글 창 없이 GitHub에 새로 받아 달라고 해요
  const btn = gConnected() || autoLinked()
    ? '<button class="link-btn" data-action="g-sync">새로고침</button>'
    : `<button class="link-btn" data-action="g-sync">${a ? '구글 다시 연결' : '구글 연결'}</button>`;
  return `<span class="gsync">${s && s !== 'auth' ? `<span class="warn">${esc(s)}</span>` : esc(when)}${btn}</span>`;
}
function renderGsync() { document.querySelectorAll('.gsync').forEach((el) => (el.outerHTML = gsyncLine())); }

/** 구글을 아직 연결하지 않았을 때 안내 */
function connectCta(what) {
  const hasId = isDemo() || !!gset().clientId;
  return `<div class="panel"><p class="pad">구글 캘린더를 연결하면 ${what} 여기에 보여요.</p>
    <div class="pad">${hasId ? '<button class="btn primary" data-action="g-sync">구글 연결하기</button>' : '<a class="btn primary" href="#settings">설정에서 연결하기</a>'}</div></div>`;
}

function eventRow(e, dayKey) {
  // 왼쪽: '종일' 또는 '10:30 - 12:00' (가운데 정렬), 일정명 아래에는 캘린더 이름만
  let when = '종일';
  if (!e.allDay) {
    const starts = e.startKey === dayKey;
    const ends = e.endKey === dayKey;
    when = starts ? `${e.time}${ends && e.endTime && e.endTime !== e.time ? ` - ${e.endTime}` : ''}` : ends ? `- ${e.endTime}` : '계속';
  }
  // 반려자 일정은 캘린더 이름 대신 '반려자'만
  const meta = esc(e.partner ? '반려자' : e.calName);
  // 장소가 있으면 일정명 오른쪽에 캘린더 이름과 같은 모양으로
  const place = e.location ? `<span class="row-place">${esc(e.location)}</span>` : '';
  const inner = `<span class="ev-time">${when}</span><span class="ev-dot${e.money ? ' money' : ''}" style="${e.color ? `--c:${esc(e.color)}` : ''}"></span>
    <span class="row-main"><span class="row-title">${esc(e.title)}${place}</span><span class="row-meta">${meta}</span></span>`;
  const cls = `row ev${e.partner ? ' partner' : ''}`;
  // 내가 쓸 수 있는 캘린더 일정은 눌러서 앱에서 고쳐요
  if (!e.money && canWrite(e.calId) && !e.id.startsWith('tmp-')) return `<button class="${cls}" data-action="event-edit" data-cal="${esc(e.calId)}" data-id="${esc(e.id)}">${inner}</button>`;
  if (!e.link) return `<div class="${cls} static">${inner}</div>`;
  return e.money ? `<a class="${cls}" href="${e.link}">${inner}</a>` : `<a class="${cls}" href="${esc(e.link)}" target="_blank" rel="noopener">${inner}</a>`;
}

function taskRow(t) {
  const label = t.due ? dueLabel(t.due, today()) : '';
  const late = t.due && t.due < today() && !t.done;
  const meta = [label ? `<span class="${late ? 'late' : ''}">${label}${t.time ? ` ${t.time}` : ''}</span>` : t.time || '', t.repeat ? esc(repeatLabel(t.repeat, t.due)) : '', esc(String(t.notes || '').split('\n')[0])].filter(Boolean).join(' · ');
  return `<div class="row task${t.done ? ' done' : ''}">
    <button class="tcheck${state.justToggled === t.id ? ' just' : ''}" data-action="task-toggle" data-id="${esc(t.id)}" role="checkbox" aria-checked="${t.done}" aria-label="${esc(t.title)} ${t.done ? '완료 취소' : '완료'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>
    <button class="row-main" data-action="task-edit" data-id="${esc(t.id)}"><span class="row-title">${esc(t.title)}</span>${meta ? `<span class="row-meta">${meta}</span>` : ''}</button>
  </div>`;
}

/** 홈 맨 위 '오늘' */
function todayBlock() {
  const a = state.agenda;
  const d = now();
  const title = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
  const key = today();
  const evs = a ? eventsOn([...agendaEvents(), ...moneyEvents(0)], key) : [];
  const g = groupTasks(state.tasks, key);
  const due = todayTasks(state.tasks, key); // 오늘 끝낸 할일도 체크된 채로 남아요
  return section(title, `<div class="today">
      <div class="panel list"><div class="mini-head">일정 <a class="link-btn" href="#calendar">전체</a></div>${!a ? connectCta('오늘 일정이') : evs.length ? evs.map((e) => eventRow(e, key)).join('') : empty('오늘은 일정이 없어요.')}</div>
      <div class="panel list"><div class="mini-head">할일 <a class="link-btn" href="#tasks">전체</a></div>${due.length ? due.map(taskRow).join('') : empty(g.tomorrow.length ? `오늘 할일은 끝! 내일 할일이 ${g.tomorrow.length}개 있어요.` : '오늘 할일이 없어요.')}</div>
    </div>`, { action: a ? gsyncLine() : '' });
}

// ───── 오늘 → 월 달력: 일정(캘린더 색), 할일, 고정지출·상환 ─────
function monthBlock() {
  const ym = state.calMonth || today().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const start = new Date(y, m - 1, 1 - first.getDay()); // 일요일부터
  const weeks = Math.ceil((first.getDay() + days) / 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7 - 1);
  const evs = agendaEvents();
  const money = new Map();
  for (const x of outflowsBetween(state.data, start, end, now())) { const k = ymd(x.date); money.set(k, [...(money.get(k) || []), x]); }
  const tasks = new Map();
  for (const t of state.tasks) if (t.due) tasks.set(t.due, [...(tasks.get(t.due) || []), t]);
  const todayKey = today();
  const sel = state.calSel || ''; // 고른 날이 없으면 아래 목록도 없어요
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = ymd(d);
    const all = eventsOn(evs, k);
    // 반려자 일정은 칸 안에 늘어놓지 않고 날짜 옆 작은 점으로만 (자세한 건 날짜를 누르면 아래에)
    const de = all.filter((e) => !e.partner);
    const pcolors = [...new Set(all.filter((e) => e.partner).map((e) => e.color || '#8b8a83'))].slice(0, 2);
    const mo = money.get(k) || [];
    const tk = (tasks.get(k) || []);
    const open = tk.filter((t) => !t.done);
    const label = [`${d.getMonth() + 1}월 ${d.getDate()}일`, de.length ? `일정 ${de.length}개` : '', pcolors.length ? '반려자 일정 있음' : '', open.length ? `할일 ${open.length}개` : '', mo.length ? `출금 ${mo.length}건` : ''].filter(Boolean).join(', ');
    cells.push(`<button class="mday${d.getMonth() !== m - 1 ? ' out' : ''}${k === todayKey ? ' today' : ''}${k === sel ? ' sel' : ''}${d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : ''}" data-action="cal-day" data-key="${k}" aria-label="${label}" aria-pressed="${k === sel}">
      <span class="mhead"><span class="num">${d.getDate()}</span>${pcolors.length ? `<span class="pdots">${pcolors.map((c) => `<i style="--c:${esc(c)}"></i>`).join('')}</span>` : ''}</span>
      <span class="mdots">${de.slice(0, 4).map((e) => `<i style="--c:${esc(e.color || '#8b8a83')}"></i>`).join('')}${mo.length ? '<i class="m">₩</i>' : ''}${open.length ? '<i class="t"></i>' : ''}</span>
      <span class="mchips">${de.slice(0, 3).map((e) => `<span class="mchip" style="--c:${esc(e.color || '#8b8a83')}">${e.allDay ? '' : `${e.time} `}${esc(e.title)}</span>`).join('')}${de.length > 3 ? `<span class="mmore">+${de.length - 3}</span>` : ''}${mo.map((x) => `<span class="mchip money"><b class="won">₩</b>${esc(x.name)}</span>`).slice(0, de.length >= 3 ? 0 : 3 - de.length).join('')}${open.length ? `<span class="mtask">할일 ${open.length}</span>` : ''}</span>
    </button>`);
  }
  const a = state.agenda;
  const outOfRange = a?.from && (ymd(first) < a.from || ymd(new Date(y, m, 0)) > agendaUntil(a));
  const nav = `<span class="mnav">
    ${ym !== todayKey.slice(0, 7) ? '<button class="link-btn" data-action="cal-month" data-key="0">오늘</button>' : ''}
    <button class="icon-btn" data-action="cal-month" data-key="-1" aria-label="지난달"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>
    <button class="icon-btn" data-action="cal-month" data-key="1" aria-label="다음 달"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
  </span>`;
  return section(`${y === now().getFullYear() ? '' : `${y}년 `}${m}월`, `<div class="panel mcal-wrap">
      <div class="mcal-head">${'일월화수목금토'.split('').map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
      <div class="mcal${state.calAnim === 'next' || state.calAnim === 'prev' ? ` slide-${state.calAnim}` : ''}">${cells.join('')}</div>
      <div class="mlegend"><span><i style="--c:var(--text-secondary)"></i>일정</span><span><i class="t"></i>할일</span><span><i class="m">₩</i>고정지출·상환</span></div>
    </div>
    ${sel ? dayDetail(sel, evs, money.get(sel) || outflowsBetween(state.data, fromKey(sel), fromKey(sel), now()), tasks.get(sel) || []) : '<p class="hint">날짜를 누르면 그날 일정·할일·나가는 돈을 보여드려요.</p>'}
    ${outOfRange ? `<p class="hint">구글 일정은 ${mdw(fromKey(a.from))} ~ ${mdw(fromKey(agendaUntil(a)))}만 받아 둬요.</p>` : ''}
    ${!a ? '<p class="hint">구글 캘린더를 연결하면 일정·할일도 달력에 보여요.</p>' : ''}`, { action: nav });
}

/** 달력에서 고른 날: 일정 · 할일 · 나가는 돈 */
function dayDetail(key, evs, money, tasks) {
  const d = fromKey(key);
  const de = eventsOn(evs, key);
  // 일정(+ 출금)과 할일을 나눠 둬요: 넓은 화면에선 좌우 두 칸, 좁으면 지금처럼 한 줄로 이어서
  const moneyRow = (x, cls) => `<div class="row static ev ${cls}"><span class="ev-time">${x.loan ? '상환' : '출금'}</span><b class="won">₩</b><span class="row-main"><span class="row-title">${esc(x.name)}</span><span class="row-meta">${x.loan ? '대출 상환' : '고정지출'}</span></span><span class="row-side"><span class="row-value">${wonExact(x.amount)}</span></span></div>`;
  // 출금은 넓을 땐 일정 칸 아래, 좁을 땐 지금처럼 맨 뒤에 (같은 줄을 두 곳에 두고 화면 폭에 따라 하나만 보여요)
  const left = [...de.map((e) => eventRow(e, key)), ...money.map((x) => moneyRow(x, 'wide-only'))];
  const right = tasks.map(taskRow);
  const col = (cls, rows, none) => `<div class="list dd-col ${cls}">${rows.length ? rows.join('') : `<p class="empty dd-none">${none}</p>`}</div>`;
  const body = left.length || right.length
    ? `<div class="dd-cols">${col('dd-ev', left, '이날은 일정이 없어요.')}${col('dd-task', right, '이날은 할일이 없어요.')}${money.length ? `<div class="list dd-col dd-money">${money.map((x) => moneyRow(x, '')).join('')}</div>` : ''}</div>`
    : empty('이날은 일정·할일·출금이 없어요.');
  const adds = state.agenda ? `<span class="head-actions"><button class="link-btn" data-action="cal-add" data-key="${key}">+ 일정</button><button class="link-btn" data-action="cal-add-task" data-key="${key}">+ 할일</button></span>` : '';
  return `<div class="panel list day-detail${state.calAnim === 'day' ? ' appear' : ''}"><div class="mini-head">${key === today() ? '오늘 · ' : ''}${mdw(d)}${adds}</div>${body}</div>`;
}

function viewCalendar() {
  const a = state.agenda;
  if (!a) return section('다가오는 일정', connectCta('앞으로의 일정이'), { action: gsyncLine() });
  const days = state.calDays || 14;
  const list = agendaDays([...agendaEvents(), ...moneyEvents(days)], now(), days);
  return `${composer('event-add', 'event-input', '새 일정', '넣기', 'event-preview')}
  ${section(`앞으로 ${days === 14 ? '2주' : '한 달'}`, `${list.length ? list.map((d) => `<div class="day-group"><h3>${d.label}</h3><div class="panel list">${d.events.map((e) => eventRow(e, d.key)).join('')}</div></div>`).join('') : `<div class="panel">${empty('이 기간에는 일정이 없어요.')}</div>`}
    ${days === 14 ? '<div class="more"><button class="btn" data-action="cal-more">한 달까지 보기</button></div>' : ''}
    <p class="hint">구글 캘린더와 연결돼 있어서, 여기서 넣고 고친 일정이 구글 캘린더에도 바로 들어가요. 일정을 누르면 고칠 수 있어요. 보여줄 캘린더는 설정에서 골라요.</p>`, { action: gsyncLine() })}`;
}
/** 일정·할일 입력칸: 메모 칸과 같은 모양. Enter로 넣고, 아래 줄에 알아들은 내용을 미리 보여줘요 */
const ENTER_HINT = ''; // 비어 있으면 PC에서만 'Enter로 넣기'를 보여줘요 (CSS)
function composer(formId, inputId, label, verb, previewId) {
  return `<form id="${formId}" class="ask-box memo-capture" autocomplete="off">
    <label for="${inputId}" class="ask-label">${label}</label>
    <textarea id="${inputId}" rows="3" aria-label="${label}" enterkeyhint="done"></textarea>
    <div class="memo-capture-foot"><span class="hint compose-hint" id="${previewId}"></span><button class="ask-send" type="submit">${verb}</button></div>
  </form>`;
}

const TASK_GROUPS = [['overdue', '지난 할일'], ['today', '오늘'], ['tomorrow', '내일'], ['week', '이번 주'], ['later', '나중에'], ['nodate', '날짜 없음']];
function viewTasks() {
  const g = groupTasks(state.tasks, today());
  const open = TASK_GROUPS.filter(([k]) => g[k].length);
  const old = ymd(new Date(now().getFullYear(), now().getMonth(), now().getDate() - 30));
  const done = g.done.filter((t) => !t.completedAt || t.completedAt >= old);
  return `${composer('task-add', 'task-input', '새 할일', '추가', 'task-preview')}
  ${open.length ? open.map(([k, l]) => section(l, `<div class="panel list">${g[k].map(taskRow).join('')}</div>`, { sum: `${g[k].length}` })).join('') : section('남은 할일', `<div class="panel">${empty('남은 할일이 없어요. 위에서 새로 추가해 보세요.')}</div>`)}
  ${done.length ? `<section class="block"><div class="panel">${details('tasks-done', `완료한 일 <span class="hint">최근 30일 ${done.length}개</span>`, `<div class="list">${done.map(taskRow).join('')}</div>`)}</div></section>` : ''}
  <p class="hint">할일은 차곡차곡에 저장돼서 PC·휴대폰 어디서나 함께 보여요. 시간을 넣은 할일은 30분 전에 알려 드려요.</p>`;
}

/** 설정 → Face ID 잠금 (이 기기에만) */
function lockSettings() {
  const c = lockConfig();
  if (state.lockOk == null) return '<div class="panel"><p class="hint pad">확인 중…</p></div>';
  // 아이폰 홈 화면 앱은 '지원함'을 제대로 알려주지 않을 때가 있어서, Face ID 버튼은 그대로 두고 직접 시도해 봐요
  if (!c) return `<div class="panel"><p class="pad">앱을 열 때 잠금을 풀어야 화면이 보이게 해요. 이 기기에만 적용되고, 기기마다 따로 켜요.</p>
    <div class="pad lock-choices">
      ${window.PublicKeyCredential ? '<button class="btn primary" data-action="lock-on">Face ID·지문으로 잠그기</button>' : ''}
      <button class="btn${window.PublicKeyCredential ? '' : ' primary'}" data-action="lock-pin">PIN 4자리로 잠그기</button>
    </div>
    <p class="hint pad">PC처럼 생체 인증이 없는 기기는 PIN을 쓰세요. 키보드 숫자나 숫자패드로 바로 입력할 수 있어요.${window.PublicKeyCredential && !state.lockOk ? ' 아이폰 Face ID는 설정 → 내 이름 → iCloud → 암호(키체인)가 켜져 있어야 해요.' : ''}</p></div>`;
  const opts = [[0, '바로'], [1, '1분 뒤'], [5, '5분 뒤'], [15, '15분 뒤']];
  const pin = c.method === 'pin';
  return `<div class="panel list">
    <div class="row static"><span class="row-main"><span class="row-title">${pin ? 'PIN 잠금' : 'Face ID 잠금'} 켜짐 · 이 기기</span><span class="row-meta">앱을 열 때, 그리고 다른 앱·창에 다녀오면 다시 잠가요</span></span>
      <span class="head-actions">${pin ? '<button class="link-btn" data-action="lock-pin">PIN 바꾸기</button>' : ''}<button class="link-btn" data-action="lock-off">끄기</button></span></div>
    <div class="pad"><b class="mini-title">다른 앱·창에 다녀오면 다시 잠그기</b><select id="lock-after" class="select">${opts.map(([v, l]) => `<option value="${v}" ${Number(c.after ?? 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <p class="hint pad">${pin ? 'PIN은 이 기기에만, 알아볼 수 없게 바꿔서 저장해요. 잊으면 잠금 화면의 ‘다시 로그인하기’로 풀 수 있어요.' : '아이폰 ‘암호’ 앱에 이 사이트의 패스키로 저장돼요. 지우면 잠금을 풀 수 없으니, 그럴 땐 잠금 화면의 ‘다시 로그인하기’를 눌러 주세요.'}</p>
  </div>`;
}

/** 설정 → 구글 캘린더·할일 */
function googleSettings() {
  const gs = gset();
  const a = state.agenda;
  const guide = details('g-guide', gs.clientId ? '클라이언트 ID 바꾸기 · 설정 방법 다시 보기' : '처음 한 번: 구글 연결 준비 (PC에서 10분)', `<div class="pad">
    <ol class="steps">
      <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">구글 클라우드 콘솔</a>에서 새 프로젝트를 만들어요 (이름: 차곡차곡).</li>
      <li>API 및 서비스 → 라이브러리에서 <b>Google Calendar API</b>와 <b>Google Tasks API</b>를 각각 찾아 <b>사용</b>을 눌러요.</li>
      <li>API 및 서비스 → OAuth 동의 화면: 사용자 유형 <b>외부</b>, 앱 이름 차곡차곡, 이메일은 덕준님 주소. 테스트 사용자에 덕준님 구글 계정을 추가하고, 마지막에 <b>앱 게시</b>(프로덕션으로)를 눌러 두면 연결이 7일마다 끊기지 않아요.</li>
      <li>API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → <b>OAuth 클라이언트 ID</b> → 유형 <b>웹 애플리케이션</b>. 승인된 자바스크립트 원본에 <b>https://aprikotseed-cyber.github.io</b> 를 넣고 만들기.</li>
      <li>나온 <b>클라이언트 ID</b>(….apps.googleusercontent.com)를 아래에 붙여 넣고 저장 → 구글 연결하기.</li>
    </ol>
    <p class="hint">클라이언트 ID는 공개돼도 괜찮은 값이에요. 연결할 때 구글 화면에서 ‘확인되지 않은 앱’이 나오면 고급 → 차곡차곡(으)로 이동을 누르면 돼요 (덕준님이 직접 만든 앱이라 그래요).</p>
    <div class="inline"><input id="g-client" type="text" value="${esc(gs.clientId || '')}" placeholder="…apps.googleusercontent.com" autocomplete="off"><button class="btn" data-action="g-client-save">저장</button></div>
  </div>`);
  if (isDemo()) return `<div class="panel"><p class="pad">체험 모드에서는 예시 일정·할일을 보여줘요. 실제 구글 연결은 로그인한 앱에서 할 수 있어요.</p>${keywordPanel()}</div>`;
  if (!gs.clientId) return `<div class="panel"><p class="pad">구글 캘린더 일정을 앱에서 함께 보고, 여기서 넣고 고친 일정은 구글 캘린더에도 그대로 기록돼요. (할일은 차곡차곡에 저장돼요)</p>${guide}</div>`;
  const conn = gConnected();
  const cals = a?.calendars || [];
  return `<div class="panel list">
    <div class="row static"><span class="row-main"><span class="row-title">${conn ? '연결됨' : a ? '저장된 일정을 보여주는 중' : '아직 연결 전'}</span><span class="row-meta">${a?.syncedAt ? `마지막으로 받은 때 ${dateTime(a.syncedAt)}` : '구글 연결하기를 누르면 구글 화면에서 허용을 눌러 주세요'}${conn ? ' · 이 창에서 1시간 동안 연결돼요' : ''}</span></span>
      ${conn ? '<button class="link-btn" data-action="g-disconnect">연결 끊기</button>' : ''}</div>
    <div class="pad actions"><button class="btn primary" data-action="g-sync">${conn ? '지금 새로 받기' : '구글 연결하기'}</button></div>
    ${cals.length ? `<div class="pad"><b class="mini-title">보여줄 캘린더</b><div class="cal-prefs">${cals.filter((c) => !calPref(c).hidden).map((c) => { const p = calPref(c); return `<div class="cal-pref"><label><input type="checkbox" data-cal-show="${esc(c.id)}" ${p.show ? 'checked' : ''}><span class="ev-dot" style="--c:${esc(c.color)}"></span>${esc(c.name)}</label><span class="cal-opts"><label class="hint"><input type="checkbox" data-cal-partner="${esc(c.id)}" ${p.partner ? 'checked' : ''}>반려자</label><button class="link-btn" data-action="cal-hide" data-id="${esc(c.id)}">숨기기</button></span></div>`; }).join('')}</div>
      ${cals.some((c) => calPref(c).hidden) ? details('cal-hidden', `숨긴 캘린더 ${cals.filter((c) => calPref(c).hidden).length}개`, `<div class="cal-prefs">${cals.filter((c) => calPref(c).hidden).map((c) => `<div class="cal-pref"><span class="hint"><span class="ev-dot" style="--c:${esc(c.color)}"></span> ${esc(c.name)}</span><button class="link-btn" data-action="cal-unhide" data-id="${esc(c.id)}">다시 보이기</button></div>`).join('')}</div>`) : ''}
      <p class="hint">반려자 캘린더 일정은 하루 일정 맨 뒤에 보여줘요. 새로 켠 캘린더는 다음에 받아올 때부터 보여요.</p></div>` : ''}
    ${autoSyncPanel()}
    ${naverPanel()}
    ${keywordPanel()}
    ${guide}
  </div>`;
}

function setGoogle(patch) {
  state.data.settings = { ...(state.data.settings || {}), google: { ...gset(), ...patch } };
  commit();
}

// ───────────────────────── 그리기 ─────────────────────────
const VIEWS = { home: viewHome, money: viewMoney, calendar: viewCalendar, tasks: viewTasks, memo: viewMemo, assets: viewAssets, debts: viewDebts, fixed: viewFixed, records: viewRecords, settings: viewSettings };
const TITLES = { home: '오늘', money: '자산 홈', calendar: '일정', tasks: '할일', memo: '메모', assets: '자산', debts: '부채', fixed: '고정지출', records: '기록', settings: '설정' };
// 자산 메뉴 안의 작은 탭: 자산 | 부채 | 고정지출
const MONEY_TABS = [['money', '홈'], ['assets', '자산'], ['debts', '부채'], ['fixed', '고정지출'], ['records', '기록']];
const navTab = (t) => (MONEY_TABS.some(([k]) => k === t) ? 'money' : t);
const subNav = () => `<nav class="segment subnav" aria-label="자산 메뉴">${MONEY_TABS.map(([k, l]) => `<a href="#${k}" role="tab" aria-selected="${state.tab === k}">${l}</a>`).join('')}</nav>`;
const SYNC = { saving: '저장 중', saved: '동기화됨', offline: '오프라인', demo: '체험 모드' };

function render() {
  if (state.dragging) return; // 끄는 중에는 다시 그리지 않아요 (실시간 갱신이 와도)
  $('#login').hidden = !!state.user;
  $('#app').hidden = !state.user;
  if (!state.user) return;
  if (!VIEWS[state.tab]) state.tab = 'home';
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === navTab(state.tab) ? 'page' : 'false'));
  renderSync();
  renderAlerts();
  const money = navTab(state.tab) === 'money';
  const kept = lastTab === state.tab ? keepTyping() : null;
  $('#view').innerHTML = `<h1 class="page-title">${TITLES[state.tab]}${state.tab === 'assets' ? assetsTitleSum() : state.tab === 'debts' ? debtsTitleSum() : ''}</h1>${money ? subNav() : ''}${VIEWS[state.tab]()}`;
  // 메뉴를 옮겼을 때만 새 화면이 살짝 떠오르며 나타나요 (실시간 갱신 때는 그대로)
  if (lastTab !== state.tab) {
    const v = $('#view');
    v.classList.remove('enter', 'sub');
    if (lastTab && !reduceMotion()) {
      void v.offsetWidth;
      v.classList.add('enter');
      if (money && navTab(lastTab) === 'money') v.classList.add('sub'); // 자산 안 작은 탭끼리는 탭 줄은 그대로
      clearTimeout(v._t);
      v._t = setTimeout(() => v.classList.remove('enter', 'sub'), 700);
    }
    lastTab = state.tab;
  }
  kept?.();
  afterRender();
}
let lastTab = '';

/**
 * 쓰던 글 지키기: 실시간 갱신(동기화·시세·앱으로 돌아오기 등)으로 화면을 다시 그려도
 * 입력칸에 쓰던 글·커서 위치·포커스를 그대로 되살려요. 돌려주는 함수를 다시 그린 뒤에 불러요.
 */
function keepTyping() {
  const fields = [...$('#view').querySelectorAll('input[id], textarea[id]')]
    .filter((el) => !['checkbox', 'radio', 'hidden', 'file'].includes(el.type) && el.value)
    .map((el) => ({ id: el.id, value: el.value }));
  const a = document.activeElement;
  const focus = a && a.id && $('#view').contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)
    ? { id: a.id, start: a.selectionStart, end: a.selectionEnd, scroll: a.scrollTop } : null;
  if (!fields.length && !focus) return null;
  return () => {
    for (const f of fields) {
      const el = document.getElementById(f.id);
      if (el && !el.value) { el.value = f.value; el.dispatchEvent(new Event('input', { bubbles: true })); } // 미리보기도 다시
    }
    const el = focus && document.getElementById(focus.id);
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(focus.start, focus.end); } catch { /* 날짜 칸 등 */ }
      el.scrollTop = focus.scroll;
    }
  };
}

// ───── 부드러운 움직임 ─────
/**
 * 당겨서 새로고침 (홈 화면에 추가한 앱에서만, 브라우저는 자체 기능이 있어요)
 * 맨 위에서 아래로 당기면 로고가 따라 내려오며 돌고, 충분히 당긴 뒤 놓으면 새로 받아요.
 * 페이지를 다시 불러오지 않아서 잠금 화면이 다시 뜨지 않아요.
 */
function pullToRefresh() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone || !matchMedia('(pointer: coarse)').matches) return;
  // 아이폰처럼 가는 막대 12개가 둥글게 놓인 로딩 표시. 당길수록 막대가 하나씩 생기고, 놓으면 돌아요
  const ind = Object.assign(document.createElement('div'), { className: 'ptr', innerHTML: `<span class="spinner">${'<i></i>'.repeat(12)}</span>` });
  const spokes = ind.querySelectorAll('i');
  document.body.append(ind);
  const view = $('#view');
  const GO = 70;   // 이만큼 당기면 새로고침
  const MAX = 110;
  let x0 = 0;
  let y0 = null;
  let d = 0;
  let busy = false;
  const draw = (dist, anim) => {
    for (const el of [view, ind]) el.classList.toggle('ptr-back', !!anim);
    view.style.transform = dist ? `translateY(${dist}px)` : '';
    const p = Math.min(1, dist / GO);
    ind.style.opacity = String(p);
    ind.style.transform = `translate(-50%, ${dist - 44}px)`;
    if (!ind.classList.contains('spin')) spokes.forEach((s, i) => { s.style.opacity = i < Math.round(p * 12) ? String(0.25 + (i / 12) * 0.75) : '0'; });
  };
  document.addEventListener('touchstart', (e) => {
    y0 = null;
    if (busy || window.scrollY > 0 || e.touches.length > 1 || !state.user || document.querySelector('dialog[open]')) return;
    const field = e.target.closest('textarea, input, select');
    if ((field && field === document.activeElement) || e.target.closest('.as-log')) return; // 글 쓰는 중에는 당기지 않아요
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    d = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    const dx = Math.abs(e.touches[0].clientX - x0);
    if (dy <= 0 || window.scrollY > 0 || (d === 0 && dx > dy)) { if (d) draw(0, true); y0 = d ? y0 : null; d = 0; return; }
    if (e.cancelable) e.preventDefault(); // 아이폰 고무줄 튕김 대신 우리 효과
    d = Math.min(MAX, dy * 0.5);
    draw(d);
  }, { passive: false });
  document.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (d < GO) { d = 0; draw(0, true); return; }
    busy = true;
    draw(GO * 0.8, true);
    spokes.forEach((x) => { x.style.opacity = ''; }); // 이제 애니메이션이 맡아요
    ind.classList.add('spin');
    if (navigator.vibrate) navigator.vibrate(8);
    await refreshAll();
    ind.classList.remove('spin');
    d = 0;
    draw(0, true);
    busy = false;
  });
}

/** 새로고침: 새 버전이면 다시 불러오고, 아니면 일정·할일·시세를 새로 받아요 */
async function refreshAll() {
  await checkVersion();
  if (newVersion) { location.reload(); return; }
  const jobs = [new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 800))]; // 너무 빨리 끝나면 어색해서 잠깐은 돌아요
  // 자산·시세·기록: 서버에서 직접 다시 받아요 (다른 기기에서 고친 내용)
  let fresh = true;
  jobs.push(store.reload ? store.reload().catch(() => { fresh = false; }) : Promise.resolve());
  if (gConnected()) jobs.push(syncAgenda(false));
  else if (autoLinked() && state.secrets?.githubToken && Date.now() - (state.agenda?.syncedAt || 0) > 2 * 60_000) {
    jobs.push(dispatchWorkflow(repoFromLocation(location), state.secrets.githubToken, 'agenda-sync.yml').catch(() => {}));
  }
  autoRefresh();
  await Promise.all(jobs);
  render();
  toast(fresh ? '새로고침했어요.' : '인터넷에 연결되지 않아 새로 받지 못했어요.');
}

/** 입력창·비서 창: 닫힐 때도 살짝 가라앉으며 사라지게 */
function smoothDialog(d) {
  const close = d.close.bind(d);
  d.close = (v) => {
    if (!d.open || d.classList.contains('closing')) return;
    if (reduceMotion()) return close(v);
    d.classList.add('closing');
    setTimeout(() => { d.classList.remove('closing'); close(v); }, 190);
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); d.close(); });
}

/** 펼치기·접기: 높이가 부드럽게 늘고 줄어요 */
function smoothDetails(e) {
  const sum = e.target.closest('details > summary');
  if (!sum || reduceMotion() || sum.closest('dialog.lock')) return;
  const det = sum.parentElement;
  e.preventDefault();
  det._anim?.cancel();
  const from = det.offsetHeight;
  const opening = !det.open;
  if (opening) det.open = true;
  const to = opening ? det.offsetHeight : sum.offsetHeight;
  det.style.overflow = 'hidden';
  det.classList.toggle('opening', opening);
  det._anim = det.animate({ height: [`${from}px`, `${to}px`] }, { duration: 300, easing: 'cubic-bezier(.22,.8,.24,1)' });
  det._anim.onfinish = () => {
    if (!opening) det.open = false;
    det.style.overflow = '';
    det.classList.remove('opening');
    det._anim = null;
  };
}

// ───────────────────────── PC 알림 카드 ─────────────────────────
// 상환 5·3·1일 전, 고정지출 하루 전인 날에 오른쪽 아래에 떠서 닫을 때까지 남아 있어요.
// 닫은 알림은 이 기기에 기억해 두고, 다음 단계(예: 3일 전)가 되면 새로 떠요.
const DISMISS_KEY = 'chgok-alerts-closed';
const alertKey = (a) => `${a.type}:${a.id}:${ymd(a.date)}:${a.dday}`;
function closedAlerts() {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; }
}

/** PC 오른쪽 아래 알림: 비서가 상환·출금 일정을 알려 드리는 말투로 */
let alertsHtml = null;
function renderAlerts() {
  const box = $('#alerts');
  const closed = new Set(closedAlerts());
  const list = state.user ? alertsFor(state.data, now()).filter((a) => !closed.has(alertKey(a))) : [];
  const html = list.map((a) => {
    const loan = a.type === 'loan';
    const key = esc(alertKey(a));
    const when = a.dday === 0 ? '오늘' : a.dday === 1 ? '내일' : `${a.dday}일 뒤`;
    const amount = `<b>${a.exact ? '' : '약 '}${wonExact(a.amount)}</b>`;
    const from = a.account ? `${esc(a.account)}에서 ` : '';
    const msg = loan
      ? `덕준님, ${mdw(a.date)}에 <b>${esc(a.name)}</b> 상환이 있어요. ${from}${amount}이 나갈 예정이에요.`
      : `덕준님, ${mdw(a.date)}에 <b>${esc(a.name)}</b> ${amount}이 ${from}빠져나가요.`;
    return `<div class="alert-card" role="status">
      <div class="alert-head">
        <img class="alert-mark" src="assistant-mark.png" alt="" width="22" height="22"><span class="alert-who">비서</span><span class="alert-kind">${loan ? '상환 일정' : '출금 일정'} · ${when}</span>
        <button class="alert-close" data-close-alert="${key}" aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>
      </div>
      <p class="alert-msg">${msg}</p>
      <a class="alert-link" href="#${loan ? 'debts' : 'fixed'}" data-close-alert="${key}">${loan ? '부채에서 보기' : '고정지출에서 보기'}</a>
    </div>`;
  }).join('');
  // 화면을 다시 그릴 때마다 새로 만들면 등장 움직임이 반복돼서, 내용이 바뀔 때만 바꿔요
  if (html === alertsHtml) return;
  alertsHtml = html;
  box.innerHTML = html;
  alertShownAt = Date.now();
}

/** 알림을 오래 닫지 않으면 가끔 살짝 튕겨서 알려요 (보고 있는 동안만, 움직임 줄이기 설정이면 하지 않아요) */
let alertShownAt = 0;
setInterval(() => {
  const cards = document.querySelectorAll('#alerts .alert-card');
  if (!cards.length || document.visibilityState !== 'visible' || reduceMotion() || Date.now() - alertShownAt < 20_000) return;
  cards.forEach((c, i) => setTimeout(() => { c.classList.remove('nudge'); void c.offsetWidth; c.classList.add('nudge'); }, i * 120));
}, 30_000);

function renderSync() {
  document.querySelectorAll('.sync').forEach((el) => {
    el.textContent = SYNC[state.sync] || '';
    el.dataset.state = state.sync;
  });
}

function afterRender() {
  state.calAnim = ''; // 달력 움직임은 한 번만
  if (state.tab === 'money') {
    const c = $('#chart-trend');
    const mode = state.data.settings?.trendMode || 'day';
    if (c) trendChart(c, trendOf(mode).points, mode);
  }
  if (state.tab === 'assets') {
    for (const h of state.data.homes || []) {
      const mh = state.market.homes?.[h.id];
      const c = document.getElementById(`chart-home-${h.id}`);
      if (c && mh?.monthly) homeChart(c, mh.monthly.slice(-24));
    }
  }
  if (state.tab === 'settings' && !state.push.loaded && !isDemo()) loadPush();
  if (state.tab === 'settings' && state.lockOk === undefined) { state.lockOk = null; lockSupported().then((v) => { state.lockOk = v; render(); }); }
}

// ───────────────────────── 입력창 ─────────────────────────
let editing = null;

function moneyText(val) {
  return val === '' || val == null ? '' : (Number(val) / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

function openForm(kind, item, preset = {}) {
  const spec = FORMS[kind];
  editing = { kind, id: item?.id };
  let v = item || { ...preset };
  editing.schedule = item?.schedule || null;
  if (kind === 'stocks' && !item) {
    const mk = state.stockTabShown || 'us';
    v = { market: mk, avgCur: mk === 'us' ? 'USD' : 'KRW', manualCur: mk === 'us' ? 'USD' : 'KRW' };
  }
  if (kind === 'stocks' && item) v = { avgCur: 'KRW', manualCur: 'KRW', market: stockMarket(item), ...item };
  if (kind === 'fx') v = { usdKrw: state.data.settings?.usdKrw || '' };
  if (kind === 'event' || kind === 'task') {
    // 반복: 고를 수 있는 것 + 지금 규칙이 목록에 없으면 그대로 두기
    const rule = kind === 'task' ? (item ? item.repeat : preset.repeat) : preset.repeat;
    const f = spec.fields.find((x) => x.key === 'repeat');
    f.options = choiceOf(rule) === 'keep' ? [...REPEAT_CHOICES, ['keep', `${repeatLabel(rule)} (그대로)`]] : REPEAT_CHOICES;
    editing.rule = rule || null;
  }
  if (kind === 'task') v = { ...(item || preset), repeat: choiceOf(editing.rule) };
  if (kind === 'event') {
    spec.fields.find((f) => f.key === 'calId').options = writableCals().map((c) => [c.id, c.name]);
    const e = item || preset;
    v = { title: e.title || '', calId: e.calId || defaultCal(e.title || '')?.id || '', allDay: e.allDay === false || e.time ? 'time' : 'all',
      date: e.startKey || e.date || today(), endDate: e.endKey && e.endKey !== e.startKey ? e.endKey : '', time: e.time || '', endTime: e.endTime || '', location: e.location || '', repeat: choiceOf(editing.rule) };
    editing.calId = item?.calId;
    editing.recurring = !!item?.recurring;
  }
  if (isRecord(kind) && !item) {
    const list = state.data[kind === 'repayment' ? 'debts' : 'savings'] || [];
    const first = list.find((x) => x.id === preset.targetId) || list.filter((x) => !x.schedule?.length)[0];
    if (!first) return toast(kind === 'repayment' ? '직접 기록할 대출이 없어요. 상환스케줄을 불러온 대출은 자동으로 기록돼요.' : '먼저 자산에서 저축 계좌를 추가해 주세요.');
    v = { targetId: first.id, date: today(), ...recordDefaults(kind, first.id), ...(preset.amount ? { amount: Number(preset.amount), kind: '적금 납입' } : {}) };
  }
  $('#editor-title').textContent = kind === 'fx' || kind === 'trade' ? spec.title : `${spec.title} ${item ? '수정' : '추가'}`;
  $('#editor-fields').innerHTML = spec.fields.map((f) => {
    const val = v[f.key] ?? f.def ?? '';
    const id = `f-${f.key}`;
    const hint = f.hint ? `<small>${f.hint}</small>` : '';
    if (f.type === 'check') return `<label class="field check"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}><span>${f.label}</span>${hint}</label>`;
    let input;
    if (f.type === 'select') {
      const opts = f.options.some((o) => (Array.isArray(o) ? o[0] : o) === val) || val === '' ? f.options : [...f.options, val];
      input = `<select id="${id}" name="${f.key}">${opts.map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(k)}" ${k === val ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    } else if (f.type === 'money') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="text" inputmode="decimal" value="${moneyText(val)}" data-money="man" placeholder="0"><span>만원</span></div><output class="preview"></output>`;
    } else if (f.type === 'won') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="text" inputmode="numeric" value="${val === '' ? '' : Number(val).toLocaleString('ko-KR')}" data-money="won" placeholder="0"><span>원</span></div><output class="preview"></output>`;
    } else if (f.type === 'cmoney') {
      const cur = v[f.curKey] || 'KRW';
      const txt = val === '' || val == null ? '' : Number(val).toLocaleString(cur === 'USD' ? 'en-US' : 'ko-KR', { maximumFractionDigits: cur === 'USD' ? 4 : 0 });
      input = `<div class="unit cm"><input id="${id}" name="${f.key}" type="text" inputmode="decimal" value="${txt}" data-cmoney="${f.curKey}" placeholder="0">
        <div class="cur" role="group" aria-label="통화">${[['USD', '$'], ['KRW', '₩']].map(([c, sym]) => `<button type="button" data-cur="${c}" data-for="${f.curKey}" aria-pressed="${c === cur}">${sym}</button>`).join('')}</div></div>
        <input type="hidden" id="f-${f.curKey}" value="${cur}"><output class="preview"></output>`;
    } else if (f.type === 'schedule') {
      input = `<div class="schedule-box" id="${id}">${scheduleStatus(editing.schedule)}</div>
        <label class="btn file">${editing.schedule ? '다른 파일로 바꾸기' : '상환스케줄 파일 불러오기'}<input type="file" id="schedule-file" accept=".xls,.xlsx,.html,.htm,.csv,.txt" hidden></label>
        ${editing.schedule ? '<button type="button" class="link-btn" id="schedule-clear">스케줄 해제</button>' : ''}`;
    } else if (f.type === 'seg') {
      input = `<div class="segment seg-field" role="radiogroup">${f.options.map(([k, l]) => `<button type="button" role="radio" aria-selected="${String(k) === String(val)}" data-seg="${f.key}" data-val="${k}">${l}</button>`).join('')}</div><input type="hidden" id="${id}" value="${esc(val)}">`;
    } else if (f.type === 'pct') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="number" step="0.01" inputmode="decimal" value="${val}"><span>%</span></div>`;
    } else if (f.type === 'day') {
      input = `<select id="${id}" name="${f.key}"><option value="">선택 안 함</option>${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(val) === n ? 'selected' : ''}>${n}일</option>`).join('')}</select>`;
    } else if (f.type === 'acct') {
      input = `<select id="${id}" name="${f.key}"><option value="">연결 안 함</option>${(state.data.savings || []).map((o) => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    } else if (f.type === 'ref') {
      input = `<select id="${id}" name="${f.key}" required>${(state.data[f.source] || []).filter((o) => !f.filter || f.filter(o) || o.id === val).map((o) => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    } else if (f.type === 'date') {
      input = `<input id="${id}" name="${f.key}" type="date" value="${esc(val)}" ${f.optional ? '' : 'required'}>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.key}" rows="8" ${f.required ? 'required' : ''}>${esc(val)}</textarea>`;
    } else if (f.type === 'time') {
      input = `<input id="${id}" name="${f.key}" type="time" value="${esc(val)}" step="300">`;
    } else if (f.type === 'month') {
      input = `<input id="${id}" name="${f.key}" type="month" value="${esc(val)}">`;
    } else if (f.type === 'sigungu') {
      input = `<input id="${id}" name="${f.key}" list="sigungu-list" inputmode="numeric" value="${esc(val)}" placeholder="41135"><datalist id="sigungu-list">${SIGUNGU.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</datalist><output class="preview">${SIGUNGU.find(([c]) => c === val)?.[1] || ''}</output>`;
    } else if (f.type === 'number') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="number" step="any" inputmode="decimal" value="${val}"><span>${f.unit || ''}</span></div>`;
    } else {
      input = `<input id="${id}" name="${f.key}" type="text" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>`;
    }
    const show = (f.showIf ? ` data-show-key="${Object.keys(f.showIf)[0]}" data-show-val="${[].concat(Object.values(f.showIf)[0]).join('|')}"` : '') + (f.noSchedule ? ' data-no-schedule' : '');
    return `<div class="field"${show}><label for="${id}">${f.label}</label>${input}${hint}</div>`;
  }).join('');
  $('#editor-delete').hidden = !item || kind === 'trade';
  // 이미 있는 일정의 반복은 구글 캘린더에서 바꿔요 (여기서는 그 날 하나만 고쳐요)
  if (kind === 'memo' && item) {
    $('#editor-fields').insertAdjacentHTML('beforeend', `<p class="hint memo-stamp">${memoStamp(item)} <button type="button" class="link-btn" id="memo-copy">복사</button></p>`);
  }
  // 미리 만들어 둔 반복 할일: 앞으로 남은 같은 이름 할일까지 한꺼번에 지우기
  if (kind === 'task' && item) {
    const rest = state.tasks.filter((x) => x.id !== item.id && !x.done && x.title === item.title && x.due && x.due >= today());
    editing.series = rest.map((x) => x.id);
    if (rest.length) $('#editor-fields').insertAdjacentHTML('beforeend', `<p class="hint"><button type="button" class="text-btn danger" id="task-del-series">이 할일과 앞으로 남은 같은 할일 ${rest.length}개 모두 지우기</button></p>`);
  }
  if (kind === 'event' && item) $('#f-repeat')?.closest('.field')?.setAttribute('hidden', '');
  if (kind === 'event' && item) {
    $('#editor-fields').insertAdjacentHTML('beforeend', `<p class="hint">${item.recurring ? '반복 일정이라 이 날 하나만 바뀌어요. ' : ''}${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener">구글 캘린더에서 열기</a>` : ''}</p>`);
  }
  $('#editor').showModal();
  syncShowIf();
  $('#editor-fields').querySelectorAll('[data-money], [data-cmoney]').forEach(previewMoney);
  if (matchMedia('(hover: hover)').matches) $('#editor-fields input')?.focus();
}

function syncShowIf() {
  $('#editor-fields').querySelectorAll('[data-show-key]').forEach((el) => {
    el.hidden = !el.dataset.showVal.split('|').includes($(`#f-${el.dataset.showKey}`)?.value);
  });
  if (editing?.schedule) $('#editor-fields').querySelectorAll('[data-no-schedule]').forEach((el) => (el.hidden = true));
}

function scheduleStatus(sch) {
  if (!sch?.length) return '<small>은행·주택금융공사에서 받은 상환스케줄(엑셀) 파일을 불러오면 잔액, 매달 출금일과 금액, 상환 기록이 스케줄대로 자동으로 맞춰져요. 파일은 덕준님 계정에만 저장돼요.</small>';
  const t = today();
  const next = nextScheduled(sch, t);
  return `<div class="schedule-info"><b>${sch.length}회차 스케줄 적용 중</b>
    <small>${sch[0].date} ~ ${sch.at(-1).date} · 지금 남은 원금 ${wonExact(scheduleBalanceAt(sch, t))}${next ? ` · 다음 ${next.date} ${wonExact(next.payment)}` : ''}</small></div>`;
}

function rerenderScheduleField() {
  const box = $('#f-schedule');
  if (!box) return;
  const field = box.closest('.field');
  field.querySelector('.btn.file').firstChild.textContent = editing.schedule ? '다른 파일로 바꾸기' : '상환스케줄 파일 불러오기';
  box.innerHTML = scheduleStatus(editing.schedule);
  field.querySelector('#schedule-clear')?.remove();
  if (editing.schedule) field.querySelector('.btn.file').insertAdjacentHTML('afterend', '<button type="button" class="link-btn" id="schedule-clear">스케줄 해제</button>');
  $('#editor-fields').querySelectorAll('[data-no-schedule]').forEach((el) => (el.hidden = !!editing.schedule));
  syncShowIf();
}

const parseNum = (s) => Number(String(s).replace(/[^\d.\-]/g, '')) || 0;
const readMoney = (el) => Math.round(parseNum(el.value) * (el.dataset.money === 'won' ? 1 : 1e4));

function previewMoney(input) {
  const out = input.closest('.field').querySelector('.preview');
  if (input.dataset.cmoney) {
    const n = parseNum(input.value);
    const cur = $(`#f-${input.dataset.cmoney}`).value;
    const fx = state.market.fx?.USD;
    out.textContent = !n ? '' : cur === 'USD' ? `${usd(n, 2)}${fx ? ` · 지금 환율로 약 ${wonExact(n * fx)}` : ''}` : wonExact(n);
    return;
  }
  const n = readMoney(input);
  out.textContent = n ? (input.dataset.money === 'won' ? wonExact(n) : won(n)) : '';
}

function readForm() {
  const out = {};
  for (const f of FORMS[editing.kind].fields) {
    const el = $(`#f-${f.key}`);
    if (f.type === 'check') out[f.key] = el.checked;
    else if (f.type === 'money' || f.type === 'won') out[f.key] = readMoney(el);
    else if (f.type === 'cmoney') { out[f.key] = el.value === '' ? '' : parseNum(el.value); out[f.curKey] = $(`#f-${f.curKey}`).value; }
    else if (f.type === 'schedule') out.schedule = editing.schedule || null;
    else if (f.type === 'pct' || f.type === 'number') out[f.key] = el.value === '' ? (f.def ?? 0) : Number(el.value);
    else if (f.type === 'day') out[f.key] = el.value ? Number(el.value) : '';
    else if (f.type === 'seg') out[f.key] = f.str ? el.value || f.def : Number(el.value) || f.def;
    else out[f.key] = el.value.trim();
  }
  return out;
}

function saveForm() {
  const vals = readForm();
  const d = state.data;
  if (editing.kind === 'trade') return saveTrade(vals);
  if (editing.kind === 'task') return saveTask(vals);
  if (editing.kind === 'event') return saveEvent(vals);
  if (editing.kind === 'memo') return saveMemo(vals);
  if (editing.kind === 'fx') d.settings = { ...(d.settings || {}), usdKrw: vals.usdKrw };
  else if (isRecord(editing.kind)) {
    upsertRecord(d, { id: editing.id || crypto.randomUUID().slice(0, 8), type: editing.kind, ...vals });
    state.recYear = vals.date.slice(0, 4);
  } else {
    const list = (d[editing.kind] ||= []);
    const i = list.findIndex((x) => x.id === editing.id);
    // 체증식 원리금은 '언제 기준'인지 함께 저장해야 다음 달부터 늘어난 금액으로 계산할 수 있어요
    if (editing.kind === 'debts' && vals.method === 'graduated') {
      const prev = list[i];
      if (!prev || prev.payment !== vals.payment || prev.method !== 'graduated' || !prev.paymentAsOf) vals.paymentAsOf = today().slice(0, 7);
    }
    // 상환스케줄이 있으면 잔액·만기·처음 빌린 금액을 스케줄에서 채워요
    if (editing.kind === 'debts' && vals.schedule?.length) {
      const sch = vals.schedule;
      vals.balance = scheduleBalanceAt(sch, today());
      vals.maturity = sch.at(-1).date.slice(0, 7);
      vals.original = sch[0].balance + sch[0].principal; // 스케줄이 기준
    }
    if (i >= 0) list[i] = { ...list[i], ...vals };
    else list.push({ id: crypto.randomUUID().slice(0, 8), ...vals });
  }
  commit();
}

function deleteItem() {
  if (editing.kind === 'memo') {
    if (!confirm('이 메모를 지울까요?')) return false;
    store.deleteMemo(editing.id).catch((e) => toast(`지우지 못했어요: ${e.message}`));
    return true;
  }
  if (editing.kind === 'event') {
    if (!confirm(editing.recurring ? '반복 일정 중 이 날 하나만 지울까요? 구글 캘린더에서도 지워져요.' : '이 일정을 지울까요? 구글 캘린더에서도 지워져요.')) return false;
    removeEvent(editing.calId, editing.id);
    return true;
  }
  if (editing.kind === 'task') {
    if (!confirm('이 할일을 지울까요?')) return false;
    removeTask(editing.id);
    return true;
  }
  if (isRecord(editing.kind)) {
    if (!confirm('이 기록을 지울까요? 잔액에 반영했던 금액도 되돌려요.')) return false;
    deleteRecord(state.data, editing.id);
  } else {
    const item = state.data[editing.kind].find((x) => x.id === editing.id);
    if (!confirm(`'${item?.name}'을(를) 지울까요?`)) return false;
    state.data[editing.kind] = state.data[editing.kind].filter((x) => x.id !== editing.id);
  }
  commit();
  return true;
}

// ───────────────────────── 실시간 갱신 ─────────────────────────
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('out');
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(t._t);
  clearTimeout(t._o);
  t._t = setTimeout(() => {
    t.classList.add('out');
    t._o = setTimeout(() => { t.hidden = true; t.classList.remove('out'); }, reduceMotion() ? 0 : 220);
  }, 3200);
}

/** 날짜가 바뀌면 D-day·남은 금액이 맞도록 다시 그리기 */
function checkDay() {
  if (today() !== state.day) {
    state.day = today();
    render();
    recordSnapshot();
    recordDaily();
  }
}

/** 새 버전이 올라오면 화면이 안 보일 때 조용히 적용, 보고 있으면 알려주기 */
let newVersion = null;
async function checkVersion() {
  if (APP_VERSION === 'dev' || isDemo()) return;
  try {
    const { version } = await (await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    if (version && version !== APP_VERSION) {
      newVersion = version;
      if (document.hidden && !$('#editor').open) location.reload();
      else $('#update').hidden = false;
    }
  } catch { /* 오프라인 */ }
}

// ───────────────────────── 매수·매도 ─────────────────────────
function openTrade(stockId, type) {
  const s = state.data.stocks.find((x) => x.id === stockId);
  if (!s) return;
  const x = stockDetail(s, state.market);
  const cur = stockMarket(s) === 'us' ? 'USD' : s.avgCur || 'KRW';
  const buy = type === 'buy';
  FORMS.trade = {
    title: `${s.name} ${buy ? '매수' : '매도'}`,
    fields: [
      { key: 'date', label: buy ? '산 날' : '판 날', type: 'date' },
      { key: 'qty', label: buy ? '산 수량' : '판 수량', type: 'number', unit: '주', hint: buy ? `지금 ${Number(s.qty || 0)}주 보유 중` : `지금 ${Number(s.qty || 0)}주 보유 중 · 평균 ${s.avgCur === 'USD' ? usd(s.avgPrice) : wonExact(s.avgPrice)}` },
      { key: 'price', label: buy ? '산 단가 (1주)' : '판 단가 (1주)', type: 'cmoney', curKey: 'tcur' },
      ...(cur === 'USD' ? [{ key: 'krw', label: buy ? '원화 결제금액 (총액)' : '원화로 받은 금액 (총액)', type: 'won', hint: '증권사 앱의 원화 금액을 넣으면 그날 환율이 그대로 반영돼요. 비워 두면 지금 환율로 계산해요' }] : []),
      { key: 'memo', label: '메모', type: 'text', placeholder: '선택' },
    ],
  };
  editing = null;
  openForm('trade', null);
  editing.trade = { stockId, type, cur };
  // 기본값: 오늘, 현재가, 통화
  $('#f-date').value = today();
  $('#f-tcur').value = cur;
  $('#editor-fields').querySelectorAll('[data-for="tcur"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cur === cur)));
  if (x.price) $('#f-price').value = cur === 'USD' ? x.price : Math.round(x.price);
  previewMoney($('#f-price'));
}

/** 수량·단가가 바뀌면 원화 금액을 지금 환율로 미리 채워요 (직접 고친 뒤엔 그대로) */
function syncTradeKrw(e) {
  if (editing?.kind !== 'trade' || editing.trade.cur !== 'USD') return;
  const krwEl = $('#f-krw');
  if (e.target === krwEl) { krwEl.dataset.dirty = '1'; return; }
  if (krwEl.dataset.dirty) return;
  const n = (Number($('#f-qty').value) || 0) * parseNum($('#f-price').value) * (state.market.fx?.USD || 0);
  krwEl.value = n ? Math.round(n).toLocaleString('ko-KR') : '';
  previewMoney(krwEl);
}

function saveTrade(vals) {
  const { stockId, type, cur } = editing.trade;
  const i = state.data.stocks.findIndex((x) => x.id === stockId);
  const s = state.data.stocks[i];
  const tcur = vals.tcur || cur;
  let krw = vals.krw;
  if (tcur === 'KRW') krw = Math.round(vals.qty * vals.price);
  else if (!krw) krw = Math.round(vals.qty * vals.price * (state.market.fx?.USD || 0));
  try {
    const { stock, trade } = applyTrade(s, { type, qty: vals.qty, price: vals.price, cur: tcur, krw, date: vals.date, memo: vals.memo });
    state.data.stocks[i] = { ...stock, trades: [...(s.trades || []), trade] };
  } catch (err) {
    toast(err.message);
    return false;
  }
  commit();
  toast(`${s.name} ${type === 'buy' ? '매수' : '매도'}를 반영했어요.`);
  return true;
}

// ───────────────────────── 비서 ─────────────────────────
const chat = [];

function chatHtml(m, i) {
  // 처음 그려지는 말풍선만 튀어 오르게 (이미 본 말풍선은 다시 움직이지 않아요)
  const pop = m.shown ? '' : ' pop';
  // 아이메시지처럼: 같은 사람이 이어 보내면 붙여 쓰고, 묶음의 마지막 말풍선에만 꼬리
  const side = (x) => (x ? (x.me ? 'me' : 'bot') : '');
  const cur = side(m);
  const extra = !m.me && (m.action || (m.q && !m.typing));
  const grp = `${side(chat[i - 1]) === cur && !(chat[i - 1]?.action || chat[i - 1]?.q) ? ' cont' : ''}${side(chat[i + 1]) !== cur || extra ? ' tail' : ''}`;
  if (m.typing) return `<div class="msg bot typing tail${grp.includes('cont') ? ' cont' : ''}${pop}" aria-label="비서가 답을 쓰는 중"><i></i><i></i><i></i></div>`;
  const text = esc(m.text).replace(/\n/g, '<br>');
  if (m.me) return `<div class="msg me${grp}${pop}">${text}</div>`;
  // 질문에 대한 답이면 아래에 '이 답이 맞지 않았나요?'
  let fb = '';
  if (m.q && !m.unknown) {
    if (m.fb === 'sent') fb = '<p class="fb-done">개선 목록에 담았어요. 고맙습니다.</p>';
    else if (m.fb === 'open') fb = `<form class="fb-form" data-fb="${i}"><input type="text" placeholder="원래 뭘 알고 싶으셨어요? (선택)" aria-label="원래 알고 싶었던 것"><button type="submit" class="pill">담기</button></form>`;
    else fb = `<button type="button" class="fb" data-fb="${i}">이 답이 맞지 않았나요?</button>`;
  }
  if (m.unknown) fb = '<p class="fb-done">이 질문은 개선 목록에 자동으로 담겼어요.</p>';
  const after = pop ? ' fade-in' : '';
  // 일정·할일 넣기 확인 카드
  let act = '';
  if (m.action) {
    const verb = { move: '옮기', delete: '지우', memo: '저장하' }[m.action.kind] || '넣';
    const doneText = { move: '구글 캘린더에서 옮겼어요.', delete: '구글 캘린더에서 지웠어요.', task: '할일에 넣었어요.', memo: '메모에 저장했어요.' }[m.action.kind] || '구글 캘린더에 넣었어요.';
    if (m.done) act = `<p class="fb-done${after}">${{ ok: doneText, fail: `${verb}지 못했어요. 다시 해 볼까요?`, cancel: `${verb}지 않았어요.`, edit: '입력창에서 고쳐서 넣어 주세요.', busy: `${verb}는 중…` }[m.done]}</p>`;
    if (!m.done || m.done === 'fail') act += `<div class="as-chips${after}"><button type="button" class="as-act primary" data-act="do" data-i="${i}">${verb}기</button>${m.action.kind === 'event' ? `<button type="button" class="as-act" data-act="edit" data-i="${i}">고쳐서 넣기</button>` : ''}<button type="button" class="as-act" data-act="cancel" data-i="${i}">취소</button></div>`;
  }
  // 일정인지 할일인지 고르기
  if (m.choose && !m.chosen) act += `<div class="as-chips${after}">${m.choose.map((c) => `<button type="button" class="as-act" data-q="${esc(c.q)}" data-say="${esc(c.label)}">${esc(c.label)}</button>`).join('')}</div>`;
  return `<div class="msg bot${grp}${pop}">${text}</div>${act}${fb ? fb.replace(/^<(\w+) class="/, `<$1 class="${after.trim()} `) : ''}`;
}

function renderChat() {
  const log = $('#as-log');
  log.innerHTML = chat.map(chatHtml).join('');
  chat.forEach((m) => { m.shown = true; });
  log.scrollTo({ top: log.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function saveFeedback(item) {
  state.data.assistantMisses = addFeedback(state.data.assistantMisses, item);
  commit();
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let replying = Promise.resolve();

/** 내 말풍선 → 점 세 개(쓰는 중) → 비서 말풍선, 아이메시지처럼 차례로 */
function askAssistant(q) {
  q = q.trim();
  if (!q) return;
  chat.push({ me: true, text: q });
  renderChat();
  // 일정·할일도 함께 (구글을 연결해 받아 둔 것)
  // 할일은 구글 연결과 상관없이 늘 있어요 (일정은 구글 캘린더를 연결했을 때만)
  const ag = { events: state.agenda ? agendaEvents() : [], tasks: state.tasks, until: state.agenda ? agendaUntil(state.agenda) : '', calendars: state.agenda ? writableCals() : [], keywords: gset().keywords || [], linked: !!state.agenda };
  // 바로 앞에서 '일정인가요, 할일인가요?'라고 물었으면 '일정'·'할일' 한마디로 대답할 수 있어요
  const last = [...chat].reverse().find((m) => !m.me && !m.typing);
  const picked = last?.choose && !last.chosen ? pickChoice(q, last.choose) : null;
  if (last?.choose) last.chosen = true;
  const a = ask(picked || q, state.data, state.market, new Date(), ag, state.memos);
  // 모르는 질문은 저절로 개선 목록에
  if (a.unknown) saveFeedback({ q: picked || q, kind: 'unknown' });
  replying = replying.then(async () => {
    if (!reduceMotion()) {
      await wait(180);
      const typing = { typing: true };
      chat.push(typing);
      renderChat();
      await wait(Math.min(1100, 450 + a.text.length * 6)); // 답이 길수록 조금 더 '쓰는' 시간
      chat.splice(chat.indexOf(typing), 1);
    }
    const msg = { text: a.text, chips: a.chips, q: picked || q, unknown: !!a.unknown, action: a.action, choose: a.choose };
    chat.push(msg);
    renderChat();
    if (a.action?.kind === 'memo') doAction(msg, 'do'); // 메모는 확인 없이 바로 저장
  });
}

/** 비서 확인 카드의 [넣기]·[고쳐서 넣기]·[취소] */
async function doAction(m, what) {
  if (!m?.action || (m.done && m.done !== 'fail')) return;
  const a = m.action;
  if (what === 'cancel') m.done = 'cancel';
  if (what === 'edit') { m.done = 'edit'; openForm('event', null, { ...a.ev, calId: writableCals().find((c) => c.name === a.ev.calName)?.id }); }
  if (what === 'do') {
    m.done = 'busy';
    renderChat();
    const ok = a.kind === 'memo' ? await addMemo(a.text)
      : a.kind === 'task' ? await addTaskItem(a.title, a.due, { time: a.time || '', repeat: a.repeat || null })
      : a.kind === 'move' ? await moveEvent(a)
      : a.kind === 'delete' ? await removeEvent(a.calId, a.id)
      : await createEvent({ ...a.ev, calId: writableCals().find((c) => c.name === a.ev.calName)?.id });
    m.done = ok ? 'ok' : 'fail';
  }
  renderChat();
}

function openAssistant() {
  if (!chat.length) chat.push({ text: '제가 무엇을 도와드릴까요?' });
  renderChat();
  $('#assistant').showModal();
  if (matchMedia('(hover: hover)').matches) $('#as-input').focus();
}

function bind() {
  document.querySelectorAll('.assistant-open').forEach((b) => b.addEventListener('click', openAssistant));
  $('#assistant-close').addEventListener('click', () => $('#assistant').close());
  $('#assistant').addEventListener('click', (e) => {
    if (e.target === $('#assistant')) $('#assistant').close();
    const chip = e.target.closest('[data-q]');
    if (chip) askAssistant(chip.dataset.say || chip.dataset.q);
    const act = e.target.closest('[data-act]');
    if (act) doAction(chat[act.dataset.i], act.dataset.act);
    const fb = e.target.closest('button.fb');
    if (fb) {
      chat[fb.dataset.fb].fb = 'open';
      renderChat();
      $('#as-log .fb-form input')?.focus();
    }
  });
  $('#assistant').addEventListener('submit', (e) => {
    const f = e.target.closest('.fb-form');
    if (!f) return;
    e.preventDefault();
    const m = chat[f.dataset.fb];
    saveFeedback({ q: m.q, kind: 'wrong', a: m.text, want: f.querySelector('input').value.trim() });
    m.fb = 'sent';
    renderChat();
  });
  // 키보드: '/' 또는 Ctrl(⌘)+K로 비서 열기
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('dialog[open]');
    if (!state.user || typing) return;
    if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openAssistant(); }
  });
  $('#as-form').addEventListener('submit', (e) => {
    e.preventDefault();
    askAssistant($('#as-input').value);
    $('#as-input').value = '';
  });

  window.addEventListener('hashchange', () => {
    state.tab = location.hash.slice(1) || 'home';
    render();
    window.scrollTo(0, 0);
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    $('#login-error').textContent = '';
    try {
      await store.login($('#email').value.trim(), $('#password').value);
    } catch (err) {
      $('#login-error').textContent = /invalid|wrong|not-found|credential/i.test(err.code || '') ? '이메일이나 비밀번호가 맞지 않아요.' : `로그인하지 못했어요 (${err.code || err.message})`;
    } finally {
      btn.disabled = false;
    }
  });

  // 달력 바깥을 누르면 고른 날짜를 풀어요
  document.addEventListener('click', (e) => {
    if (!state.calSel || state.tab !== 'home') return;
    if (e.target.closest('.mcal-wrap, .day-detail, .mnav, dialog, .toast, .alerts')) return;
    state.calSel = '';
    render();
  });
  $('#view').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action: a, kind, id } = b.dataset;
    if (a === 'add') openForm(kind);
    if (a === 'g-sync') { if (!gConnected() && autoLinked()) requestAgendaSync(); else syncAgenda(true); }
    if (a === 'g-auto-now') requestAgendaSync();
    if (a === 'g-auto-on') turnOnAutoSync(b);
    if (a === 'g-auto-off' && confirm('자동 동기화를 끌까요? 앱을 열어 구글에 연결했을 때만 새로 받아요.')) { await store.saveSecret('googleRefresh', ''); toast('자동 동기화를 껐어요.'); }
    if (a === 'lock-on') {
      try { await enableLock(state.user?.email); toast('잠금을 켰어요. 다음에 앱을 열면 Face ID로 열려요.'); }
      catch (err) { toast(err.name === 'NotAllowedError' ? 'Face ID 등록이 취소됐거나 허용되지 않았어요. iCloud 암호(키체인)가 켜져 있는지 확인해 주세요.' : `잠금을 켜지 못했어요 (${err.name}): ${err.message}`); }
      render();
    }
    if (a === 'lock-pin') { if (await enablePin()) toast('PIN 잠금을 켰어요. 다음에 앱을 열 때 PIN을 입력해 주세요.'); render(); }
    if (a === 'lock-off' && confirm('이 기기에서 잠금을 끌까요?')) { disableLock(); toast('잠금을 껐어요.'); render(); }
    if (a === 'g-disconnect' && confirm('이 기기에서 구글 연결을 끊을까요? 저장해 둔 일정·할일은 계속 보여요.')) { gapi()?.disconnect(); render(); }
    if (a === 'g-client-save') {
      const v = $('#g-client').value.trim();
      if (v && !/\.apps\.googleusercontent\.com$/.test(v)) return toast('….apps.googleusercontent.com 으로 끝나는 클라이언트 ID를 붙여 넣어 주세요.');
      state.open.delete('g-guide');
      setGoogle({ clientId: v });
      toast(v ? '저장했어요. 이제 구글 연결하기를 눌러 주세요.' : '클라이언트 ID를 지웠어요.');
    }
    if (a === 'cal-more') { state.calDays = 31; render(); }
    if (a === 'sc-copy') {
      const { owner, repo } = repoFromLocation(location);
      const v = { 'token-url': `https://securetoken.googleapis.com/v1/token?key=${store.apiKey}`, key: store.shortcutKey(),
        'inbox-url': 'https://firestore.googleapis.com/v1/projects/chgokchgok/databases/(default)/documents/users/[user_id]/inbox',
        'gh-url': `https://api.github.com/repos/${owner}/${repo}/actions/workflows/agenda-sync.yml/dispatches`, 'gh-token': state.secrets?.githubToken || '',
        'notify-url': `https://api.github.com/repos/${owner}/${repo}/actions/workflows/notify.yml/dispatches`,
        'remind-url': `https://api.github.com/repos/${owner}/${repo}/actions/workflows/remind.yml/dispatches`, 'ref-body': '{"ref":"main"}' }[b.dataset.what];
      try { await navigator.clipboard.writeText(v); toast('복사했어요. 단축어에 붙여 넣어 주세요.'); } catch { prompt('길게 눌러 복사해 주세요', v); }
    }
    if (a === 'kw-add') {
      const word = $('#kw-word').value.trim();
      if (!word) return $('#kw-word').focus();
      const cal = $('#kw-cal').value;
      setGoogle({ keywords: [...(gset().keywords || []).filter((k) => k.word !== word), { word, cal }] });
      toast(`‘${word}’이(가) 들어간 일정은 ${cal} 캘린더로 넣을게요.`);
    }
    if (a === 'kw-del') { const ks = [...(gset().keywords || [])]; ks.splice(Number(b.dataset.i), 1); setGoogle({ keywords: ks }); }
    if (a === 'cal-hide' || a === 'cal-unhide') {
      const c = state.agenda.calendars.find((x) => x.id === b.dataset.id);
      const hide = a === 'cal-hide';
      setGoogle({ cals: { ...(gset().cals || {}), [c.id]: { ...(gset().cals?.[c.id] || {}), hidden: hide, show: !hide } } });
      toast(hide ? `‘${c.name}’을(를) 숨겼어요. 아래 ‘숨긴 캘린더’에서 다시 보이게 할 수 있어요.` : `‘${c.name}’을(를) 다시 보여줘요. 다음에 받아올 때부터 일정이 보여요.`);
      if (!hide) { if (gConnected()) syncAgenda(false); else if (autoLinked()) requestAgendaSync(); }
    }
    if (a === 'cal-day') { state.calSel = state.calSel === b.dataset.key ? '' : b.dataset.key; state.calMonth = b.dataset.key.slice(0, 7); state.calAnim = 'day'; render(); }
    if (a === 'cal-month') {
      const n = Number(b.dataset.key);
      if (!n) { state.calMonth = today().slice(0, 7); state.calSel = ''; } else {
        const [yy, mm] = (state.calMonth || today().slice(0, 7)).split('-').map(Number);
        const d = new Date(yy, mm - 1 + n, 1);
        state.calMonth = ymd(d).slice(0, 7);
        state.calSel = '';
        state.calAnim = n > 0 ? 'next' : 'prev';
      }
      render();
    }
    if (a === 'cal-add') openForm('event', null, { date: b.dataset.key, title: '' });
    if (a === 'cal-add-task') openForm('task', null, { due: b.dataset.key, title: '' });
    if (a === 'task-toggle') toggleTask(id);
    if (a === 'memo-edit') { const m = state.memos.find((x) => x.id === id); if (m) openMemoEditor(m); }
    if (a === 'memo-pin') toggleMemoPin(id);
    if (a === 'event-edit') { const ev = state.agenda?.events.find((x) => x.id === id && x.calId === b.dataset.cal); if (ev) openForm('event', ev); }
    if (a === 'task-edit') { const t = findTask(id); if (t) openForm('task', t); }
    if (a === 'edit') openForm(kind, state.data[kind]?.find((x) => x.id === id));
    if (a === 'trade') openTrade(id, b.dataset.type);
    if (a === 'deposit') openForm(b.dataset.type, null, { targetId: id, amount: b.dataset.amount });
    if (a === 'add-sub') openForm('fixed', null, { category: '구독', cycle: 'monthly', active: true });
    if (a === 'dep-year') { state.depYear = Number(b.dataset.key); render(); }
    if (a === 'trade-undo') {
      const s = state.data.stocks.find((x) => x.id === id);
      const last = s?.trades?.at(-1);
      if (last && confirm(`${last.date} ${last.type === 'buy' ? '매수' : '매도'} ${last.qty}주를 취소할까요? 그 전 보유 상태로 돌아가요.`)) {
        Object.assign(s, undoLastTrade(s));
        if (!s.trades.length) delete s.trades;
        commit();
      }
    }
    if (a === 'fx') openForm('fx', {});
    if (a === 'refresh') requestRefresh(kind || 'quotes');
    if (a === 'months-all') {
      const open = b.dataset.open === '1';
      for (const ym of b.dataset.yms.split(',')) {
        const key = `rec-${ym}`;
        if (open) { state.open.add(key); state.open.delete(`${key}-closed`); } else { state.open.delete(key); state.open.add(`${key}-closed`); }
      }
      render();
    }
    if (a === 'reorder') { state.reorder = state.reorder === b.dataset.key ? null : b.dataset.key; render(); }
    if (a === 'token-save') {
      const v = $('#gh-token').value.trim();
      if (v && !/^(github_pat_|ghp_)/.test(v)) return toast('github_pat_ 로 시작하는 토큰을 붙여 넣어 주세요.');
      try { await store.saveSecret('githubToken', v); toast(v ? '토큰을 저장했어요. 이제 지금 업데이트 버튼을 쓸 수 있어요.' : '토큰을 지웠어요.'); }
      catch (e) { toast(e.message); }
    }
    if (a === 'token-clear' && confirm('저장된 GitHub 토큰을 지울까요?')) { await store.saveSecret('githubToken', ''); toast('토큰을 지웠어요.'); }
    if (a === 'trend') { state.data.settings = { ...(state.data.settings || {}), trendMode: b.dataset.key }; commit(); }
    if (a === 'stock-tab') { state.stockTab = b.dataset.key; render(); }
    if (a === 'stock-pin') {
      const cur = state.data.settings?.stockPin;
      state.data.settings = { ...(state.data.settings || {}), stockPin: cur === state.stockTabShown ? '' : state.stockTabShown };
      commit();
      toast(state.data.settings.stockPin ? '자산 탭을 열면 이 묶음이 먼저 보여요.' : '기본 탭 고정을 풀었어요.');
    }
    if (a === 'stock-sort') { state.data.settings = { ...(state.data.settings || {}), stockSort: b.dataset.key }; commit(); }
    if (a === 'add-rec') openForm(b.dataset.type);
    if (a === 'edit-rec') { const r = state.data.records.find((x) => x.id === id); if (r) openForm(r.type, r); }
    if (a === 'year') { state.recYear = b.dataset.year; render(); }
    if (a === 'cand') {
      const h = state.data.homes.find((x) => x.id === id);
      h.aptName = b.dataset.name;
      commit();
      toast(`단지명을 '${b.dataset.name}'(으)로 바꿨어요. 다음 자동 수집 때 반영돼요.`);
    }
    if (a === 'logout') store.logout();
    if (a === 'misses-clear' && confirm('개선 목록을 모두 지울까요? (복사해 두셨는지 확인해 주세요)')) { state.data.assistantMisses = []; commit(); }
    if (a === 'fb-del') { state.data.assistantMisses.splice(Number(b.dataset.i), 1); commit(); }
    if (a === 'fb-copy') {
      const text = feedbackText(state.data.assistantMisses, today());
      try { await navigator.clipboard.writeText(text); toast('복사했어요. Claude와의 대화에 붙여 넣어 주세요.'); }
      catch {
        // 복사가 막힌 브라우저: 글을 보여주고 직접 복사
        const ta = Object.assign(document.createElement('textarea'), { value: text, className: 'copy-box', readOnly: true });
        b.closest('.panel').append(ta);
        ta.select();
        toast('글을 길게 눌러 복사해 주세요.');
      }
    }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `차곡차곡-백업-${today()}.json` }).click();
    }
    if (a === 'vapid-save') {
      state.data.settings = { ...(state.data.settings || {}), vapidKey: $('#vapid').value.trim() };
      state.open.delete('vapid');
      commit();
      toast('키를 저장했어요. 이제 이 기기에서 알림을 켤 수 있어요.');
    }
    if (a === 'push-enable') {
      b.disabled = true;
      try {
        await store.enablePush(state.data.settings.vapidKey);
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('차곡차곡', { body: '이 기기에서 알림을 받을 수 있어요.', icon: 'icon-192.png' });
        state.push.loaded = false;
        await loadPush();
      } catch (err) {
        toast(`알림을 켜지 못했어요: ${err.message}`);
        b.disabled = false;
      }
    }
    if (a === 'push-local') {
      try {
        const reg = await navigator.serviceWorker.getRegistration('firebase-messaging-sw.js') || await navigator.serviceWorker.ready;
        if (Notification.permission !== 'granted') throw new Error('알림 권한이 허용되지 않았어요');
        await reg.showNotification('차곡차곡', { body: '이 기기에서 바로 띄운 알림이에요. 이게 보이면 기기 설정은 괜찮아요.', icon: 'icon-192.png', tag: `local-${Date.now()}` });
        toast('알림을 띄웠어요. 화면 위나 알림 센터를 확인해 주세요.');
      } catch (err) { toast(`띄우지 못했어요: ${err.message}`); }
    }
    if (a === 'push-test') {
      try {
        await dispatchWorkflow(repoFromLocation(location), state.secrets.githubToken, 'notify.yml', fetch, { test: 'true' });
        toast('시험 알림을 요청했어요. 1분 안에 이 계정의 모든 기기로 와요.');
      } catch (err) { toast(err.message); }
    }
    if (a === 'push-remove') {
      await store.removePushDevice(b.dataset.token);
      state.push.loaded = false;
      await loadPush();
    }
  });

  // 펼친 상태 기억 (실시간으로 다시 그려도 닫히지 않게)
  $('#view').addEventListener('toggle', (e) => {
    const key = e.target.dataset?.key;
    if (!key) return;
    if (e.target.open) { state.open.add(key); state.open.delete(`${key}-closed`); } else { state.open.delete(key); state.open.add(`${key}-closed`); }
    // 월을 하나씩 펼치거나 접으면 [모두 펼치기/접기] 글자도 바로 맞춰요
    const all = $('[data-action="months-all"]');
    if (key.startsWith('rec-') && all) all.outerHTML = monthsToggle(all.dataset.yms.split(','));
  }, true);

  $('#view').addEventListener('input', (e) => {
    if (e.target.id === 'memo-search') {
      // 다시 그리지 않고 보이기만 바꿔요 (입력 중 커서 유지)
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('.memo').forEach((c) => { c.hidden = !!q && !c.dataset.text.includes(q); });
      document.querySelectorAll('[data-group]').forEach((g) => { g.hidden = ![...g.querySelectorAll('.memo')].some((c) => !c.hidden); });
      const none = $('.memo-none');
      if (none) none.hidden = !q || !!document.querySelector('.memo:not([hidden])');
    }
    if (e.target.id === 'event-input') {
      const v = e.target.value.trim();
      $('#event-preview').textContent = v ? eventPreview(parseEventInput(v, now(), writableCals(), gset().keywords)) : ENTER_HINT;
    }
    if (e.target.id === 'task-input') {
      $('#task-preview').textContent = taskPreview(e.target.value);
    }

  });
  // 비서 칸: Enter로 보내기, Shift+Enter는 줄바꿈 (한글 조합 중에는 보내지 않아요)
  $('#view').addEventListener('keydown', (e) => {
    if (e.target.id === 'home-ask-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
    // 메모는 여러 줄이라 Enter는 줄바꿈, Ctrl(⌘)+Enter로 저장
    if (e.target.id === 'memo-input' && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
    // 메모 카드: Enter·스페이스로 열기
    if (e.target.classList?.contains('memo') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); }
    // 일정·할일은 한 줄이라 Enter로 바로 넣어요
    if ((e.target.id === 'event-input' || e.target.id === 'task-input') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  $('#view').addEventListener('submit', (e) => {
    if (e.target.id === 'home-ask') {
      e.preventDefault();
      const input = $('#home-ask-input');
      const v = input.value.trim();
      if (!v) return openAssistant();
      input.value = '';
      input.blur();
      openAssistant();
      askAssistant(v);
      return;
    }
    if (e.target.id === 'memo-add') {
      e.preventDefault();
      const input = $('#memo-input');
      const text = input.value.trim();
      if (!text) return input.focus();
      input.value = '';
      addMemo(text);
      return;
    }
    if (e.target.id === 'event-add') {
      e.preventDefault();
      const input = $('#event-input');
      const p = parseEventInput(input.value, now(), writableCals(), gset().keywords);
      if (!p.title) return;
      createEvent({ ...p, date: p.date || today(), calId: defaultCal(p.title, p.calName)?.id });
      input.value = '';
      $('#event-preview').textContent = ENTER_HINT;
      return;
    }
    if (e.target.id !== 'task-add') return;
    e.preventDefault();
    const input = $('#task-input');
    if (!input.value.trim()) return input.focus();
    if (!addTask(input.value)) return input.focus(); // 시간이 있으면 넣지 않고 글은 그대로 둬요
    input.value = '';
    $('#task-preview').textContent = ENTER_HINT;
    input.focus();
  });
  $('#view').addEventListener('change', async (e) => {
    const cs = e.target.dataset.calShow || e.target.dataset.calPartner;
    if (cs) {
      const c = state.agenda.calendars.find((x) => x.id === cs);
      const key = e.target.dataset.calShow ? 'show' : 'partner';
      setGoogle({ cals: { ...(gset().cals || {}), [cs]: { ...(gset().cals?.[cs] || {}), ...calPref(c), [key]: e.target.checked } } });
      if (key === 'show' && e.target.checked) syncAgenda(false);
    }
    if (e.target.id === 'lock-after') { setLockAfter(Number(e.target.value)); toast('저장했어요.'); }
    if (e.target.id === 'import' && e.target.files[0]) {
      try {
        const d = JSON.parse(await e.target.files[0].text());
        if (!confirm('지금 데이터를 백업 파일 내용으로 바꿀까요?')) return;
        state.data = { ...EMPTY(), ...d };
        commit();
        toast('백업을 불러왔어요.');
      } catch {
        toast('백업 파일을 읽지 못했어요.');
      }
    }
  });

  pullToRefresh();
  smoothDialog($('#editor'));
  smoothDialog($('#assistant'));
  // 메모 고치기 창
  const md = $('#memo-editor');
  smoothDialog(md);
  $('#memo-edit-form').addEventListener('submit', (e) => { e.preventDefault(); if (saveMemoEdit()) md.close(); });
  $('#memo-edit-cancel').addEventListener('click', () => md.close());
  $('#memo-edit-delete').addEventListener('click', () => {
    if (!memoEditing || !confirm('이 메모를 지울까요?')) return;
    store.deleteMemo(memoEditing.id).catch((e) => toast(`지우지 못했어요: ${e.message}`));
    md.close();
  });
  md.addEventListener('click', (e) => { if (e.target === md) md.close(); });
  $('#memo-edit-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); $('#memo-edit-form').requestSubmit(); } });
  document.addEventListener('click', smoothDetails);
  const dlg = $('#editor');
  $('#editor-form').addEventListener('submit', (e) => { e.preventDefault(); if (saveForm() !== false) dlg.close(); });
  $('#editor-cancel').addEventListener('click', () => dlg.close());
  $('#editor-delete').addEventListener('click', () => deleteItem() && dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 바깥 누르면 닫기
  $('#editor-fields').addEventListener('click', (e) => {
    if (e.target.id === 'task-del-series') {
      const ids = [editing.id, ...(editing.series || [])];
      if (!confirm(`‘${$('#f-title').value}’ 할일 ${ids.length}개를 모두 지울까요?`)) return;
      ids.forEach((id) => removeTask(id));
      $('#editor').close();
      toast(`할일 ${ids.length}개를 지웠어요.`);
      return;
    }
    if (e.target.id === 'memo-copy') {
      navigator.clipboard?.writeText($('#f-text').value).then(() => toast('복사했어요.'), () => toast('복사하지 못했어요. 글을 길게 눌러 복사해 주세요.'));
    }
    const c = e.target.closest('[data-cur]');
    if (c) {
      $(`#f-${c.dataset.for}`).value = c.dataset.cur;
      c.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      previewMoney(c.closest('.field').querySelector('[data-cmoney]'));
    }
    if (e.target.id === 'schedule-clear') { editing.schedule = null; rerenderScheduleField(); }
    const sg = e.target.closest('[data-seg]');
    if (sg) {
      $(`#f-${sg.dataset.seg}`).value = sg.dataset.val;
      sg.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === sg)));
      syncShowIf();
    }
  });
  $('#editor-fields').addEventListener('change', async (e) => {
    if (e.target.id !== 'schedule-file' || !e.target.files[0]) return;
    try {
      const { rows, total } = parseSchedule(await e.target.files[0].text());
      editing.schedule = rows;
      rerenderScheduleField();
      toast(`${rows.length}회차를 읽었어요. 원금 합계 ${wonExact(total.principal)}`);
    } catch (err) {
      toast(`파일을 읽지 못했어요: ${err.message}`);
    }
    e.target.value = '';
  });
  $('#editor-fields').addEventListener('input', (e) => {
    // 새 종목에서 구분을 바꾸면 통화도 그에 맞게 (해외 → $)
    if (e.target.name === 'market' && !editing.id) {
      const cur = e.target.value === 'us' ? 'USD' : 'KRW';
      $('#editor-fields').querySelectorAll('[data-cur]').forEach((x) => { if (x.dataset.cur === cur) x.click(); });
    }
    if (e.target.matches('[data-cmoney]')) previewMoney(e.target);
    syncTradeKrw(e);
    if (e.target.matches('[data-money]')) previewMoney(e.target);
    if (e.target.name === 'targetId' && !editing.id) {
      const v = recordDefaults(editing.kind, e.target.value);
      for (const k of ['amount', 'interest']) {
        const el = $(`#f-${k}`);
        if (el && v[k] !== undefined) { el.value = v[k] === '' ? '' : Number(v[k]).toLocaleString('ko-KR'); previewMoney(el); }
      }
    }
    syncShowIf();
    if (e.target.name === 'lawdCd') e.target.closest('.field').querySelector('output').textContent = SIGUNGU.find(([c]) => c === e.target.value)?.[1] || '';
  });

  $('#update-apply').addEventListener('click', () => location.reload());

  // 순서 바꾸기: 마우스·터치 모두 (포인터 이벤트)
  let drag = null;
  $('#view').addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.sortable .handle');
    if (!h) return;
    e.preventDefault();
    const rowEl = h.closest('.sort-row');
    drag = { rowEl, list: rowEl.parentElement, startY: e.clientY, top: rowEl.getBoundingClientRect().top };
    state.dragging = true;
    rowEl.classList.add('dragging');
    try { h.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ }
  });
  $('#view').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { rowEl, list } = drag;
    // 손가락 위치가 이웃 줄의 가운데를 넘으면 자리를 바꿔요
    const others = [...list.querySelectorAll('.sort-row:not(.dragging)')];
    const after = others.find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
    if (after) { if (rowEl.nextElementSibling !== after) list.insertBefore(rowEl, after); }
    else if (list.lastElementChild !== rowEl) list.appendChild(rowEl);
    // 줄이 손가락을 따라오도록: 원래 자리(자리를 바꾼 뒤의 위치)에서 얼마나 떨어졌는지만큼 옮겨 그려요
    const natural = rowEl.getBoundingClientRect().top - (Number(rowEl.dataset.ty) || 0);
    const ty = drag.top + (e.clientY - drag.startY) - natural;
    rowEl.dataset.ty = ty;
    rowEl.style.transform = `translateY(${ty}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    drag.rowEl.classList.remove('dragging');
    drag.rowEl.style.transform = '';
    delete drag.rowEl.dataset.ty;
    const list = drag.list;
    drag = null;
    state.dragging = false;
    saveOrder(list);
  };
  $('#view').addEventListener('pointerup', endDrag);
  $('#view').addEventListener('pointercancel', endDrag);
  $('#view').addEventListener('keydown', (e) => {
    const h = e.target.closest('.sortable .handle');
    if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const rowEl = h.closest('.sort-row');
    const sib = e.key === 'ArrowUp' ? rowEl.previousElementSibling : rowEl.nextElementSibling;
    if (!sib) return;
    rowEl.parentElement.insertBefore(rowEl, e.key === 'ArrowUp' ? sib : sib.nextElementSibling);
    const id = rowEl.dataset.id;
    saveOrder(rowEl.parentElement);
    document.querySelector(`.sort-row[data-id="${CSS.escape(id)}"] .handle`)?.focus();
  });
  $('#alerts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-close-alert]');
    if (!b) return;
    const keep = closedAlerts().filter((k) => k.split(':')[2] >= ymd(new Date(Date.now() - 40 * 86400000))); // 오래된 건 정리
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...keep, b.dataset.closeAlert]));
    renderAlerts();
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { redrawAll(); render(); });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(afterRender, 200); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkDay(); checkVersion();
      // 앱으로 돌아오면 다른 기기에서 고친 내용을 서버에서 바로 받아요 (잠든 실시간 연결 대신)
      if (state.user && !isDemo()) store.reload?.().catch(() => {});
      autoRefresh();
      if (Date.now() - (state.agenda?.syncedAt || 0) > 10 * 60_000) syncAgenda(false);
    }
    else if (newVersion && !$('#editor').open) location.reload();
  });
  setInterval(checkDay, 30_000);
  setInterval(checkVersion, 5 * 60_000);
  // 앱을 오래 켜 두어도 구글 토큰이 끊기지 않게 (일정·할일 넣을 때 구글 창이 안 뜨도록)
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.user && autoLinked() && !freshServerToken(state.secrets?.googleAccess, Date.now() + 10 * 60_000)) renewServerToken();
  }, 5 * 60_000);
}

let agendaLoaded = false;
async function main() {
  bind();
  initLock({ active: () => !!state.user, onForgot: () => store.logout() });
  store = await connect({
    onAuth: (u) => { state.user = u; state.push.loaded = false; if (!u) { state.agenda = null; agendaLoaded = false; } lockNow(); render(); },
    onData: (d) => { serverBase = JSON.parse(JSON.stringify(d || {})); state.data = { ...EMPTY(), ...(d || {}) }; refreshMarket(); render(); recordSnapshot(); recordDaily(); },
    onMarket: (m) => { state.marketRaw = m || {}; const first = !state.marketLoaded; state.marketLoaded = true; if (first) setTimeout(autoRefresh, 1500); refreshMarket(); render(); recordSnapshot(); recordDaily(); },
    onSecrets: (sc) => { const first = !state.secretsLoaded; state.secretsLoaded = true; state.secrets = sc || {}; if (first) setTimeout(autoRefresh, 1500); if (['settings', 'home', 'calendar', 'tasks'].includes(state.tab)) render(); },
    onHistory: (h) => { state.history = h || {}; state.historyLoaded = true; if (state.tab === 'money') render(); recordDaily(); },
    onSync: (s) => { state.sync = s; if (state.user) renderSync(); },
    onMemos: (list) => { state.memos = list || []; if (state.tab === 'memo') render(); },
    onTasks: (list) => { state.tasks = (list || []).map(normLocalTask); render(); },
    onAgenda: (a) => {
      const first = !agendaLoaded;
      agendaLoaded = true;
      if (a && !syncing) state.agenda = a;
      render();
      if (first) syncAgenda(false); // 이 창에서 이미 연결돼 있으면 조용히 새로 받기
    },
  });
  $('#boot').hidden = true;
  checkVersion();
}

main().catch((e) => {
  $('#boot').textContent = `불러오지 못했어요: ${e.message}`;
});
