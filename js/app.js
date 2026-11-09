import { connect, isDemo } from './store.js?v=20261110b';
import { currentTotals, currentPayment, homeValue, loanThisMonth, graduatedInfo, loanBalance, stockDetail, stockMarket, normTicker } from './projection.js?v=20261110b';
import { parseSchedule, scheduleBalanceAt, nextScheduled, paidRows, ymd } from './schedule.js?v=20261110b';
import { upsertRecord, deleteRecord, yearlySummary, monthlySummary, byTarget, today, scheduleRecords } from './records.js?v=20261110b';
import { upcoming, fixedSummary, nextDue, daysBetween, ALERT_DAYS, alertsFor } from './reminders.js?v=20261110b';
import { won, wonExact, pct, esc, ymLabel, dateTime, mdw } from './format.js?v=20261110b';
import { trendChart, homeChart, redrawAll } from './charts.js?v=20261110b';
import { trend, makeEntry, sameEntry, sinceLast } from './history.js?v=20261110b';
import { ask, SUGGEST } from './assistant.js?v=20261110b';
import { applyTrade, undoLastTrade, realizedKrw } from './trades.js?v=20261110b';
import { addFeedback, feedbackText } from './feedback.js?v=20261110b';
import { repoFromLocation, dispatchWorkflow, WORKFLOWS } from './github.js?v=20261110b';

const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

const EMPTY = () => ({
  savings: [], stocks: [], homes: [], debts: [], fixed: [],
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
      { key: 'payDay', label: '매달 상환일', type: 'day', noSchedule: true, hint: '상환일 5·3·1일 전에 알려드려요' },
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
      { key: 'day', label: '매달 출금일', type: 'day', hint: '출금 하루 전에 알려드려요. 31일은 짧은 달엔 말일로 계산해요' },
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
  saveTimer = setTimeout(() => store.save(JSON.parse(JSON.stringify(state.data))).catch((e) => toast(`저장하지 못했어요: ${e.message}`)), 300);
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
  commit();
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
function viewHome() {
  const d = state.data;
  const t = currentTotals(d, state.market);
  const saved = t.savings + t.stocks;
  const ym = today().slice(0, 7);
  const prevKey = Object.keys(d.snapshots || {}).filter((k) => k < ym).sort().pop();
  const diff = prevKey ? t.net - d.snapshots[prevKey].net : null;
  const pay = (d.debts || []).reduce((a, l) => a + currentPayment(l), 0);
  const isEmpty = !t.assets && !t.debts;

  const mode = d.settings?.trendMode || 'day';
  const tr = trend(state.history, d.snapshots, mode, now());
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
        <tbody>${tr.points.slice().reverse().map((p) => `<tr><th>${p.label}</th><td>${won(p.net)}</td><td class="${p.diff ? (p.diff.net >= 0 ? 'up' : 'down') : ''}">${p.diff ? `${p.diff.net >= 0 ? '+' : '−'}${won(Math.abs(p.diff.net))}` : '-'}</td><td>${p.savings == null ? '-' : won(p.savings)}</td><td>${p.homes == null ? '-' : won(p.homes)}</td><td>${won(p.debts)}</td></tr>`).join('')}</tbody>
      </table></div>`) : ''}
    </div>
    <p class="hint">총자산 = 저축액(주식 포함) + 주택 − 대출잔액. 앱을 열 때와 시세를 받아올 때마다 그날 값으로 기록해요.</p>`)}
  </div></div>`;
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
    return `<div class="stock">
      ${row({
        kind: 'savings', id: s.id, title: esc(s.name),
        meta: [s.kind, s.monthly ? `매달 ${won(s.monthly)}` : '', s.rate ? `연 ${pct(s.rate)}` : ''].filter(Boolean).join(' · '),
        value: won(s.balance),
      })}
      <div class="trade-bar">
        <button class="pill buy" data-action="deposit" data-type="saving" data-id="${esc(s.id)}">입금</button>
        <button class="pill sell" data-action="deposit" data-type="withdraw" data-id="${esc(s.id)}">출금</button>
      </div>
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
  ${section('주식', stk, { action: `<span class="head-actions">${refreshBtn(m)}${addBtn('stocks', '새 종목')}</span>` })}
  </div><div class="col-side">
  ${section('주택', `<div class="panel list">${homes || empty('단지명과 전용면적을 넣으면 국토부 실거래가로 시세가 반영돼요.')}</div>`, { sum: won(t.homes), action: addBtn('homes') })}
  </div></div>
  ${updateLine(m)}`;
}

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
    return `<div class="stock ${held ? '' : 'sold'}">
      <button class="row" data-action="edit" data-kind="stocks" data-id="${esc(s.id)}">
        <span class="row-main"><span class="row-title">${esc(s.name)}${held ? '' : ' <span class="badge">전량 매도</span>'}</span><span class="row-meta">${meta}</span>${fxNote}</span>
        <span class="row-side"><span class="row-value">${won(x.valueKrw)}</span>${sub ? `<span class="row-meta">${sub}</span>` : ''}</span>
      </button>
      <div class="trade-bar">
        <button class="pill buy" data-action="trade" data-type="buy" data-id="${esc(s.id)}">매수</button>
        <button class="pill sell" data-action="trade" data-type="sell" data-id="${esc(s.id)}" ${held ? '' : 'disabled'}>매도</button>
      </div>
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
  return `
  <section class="panel stats">
    <div class="stat"><span class="eyebrow">대출잔액</span><span class="stat-num">${won(t.debts)}</span></div>
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
    ...(d.fixed || []).map((f) => ({ kind: 'fixed', id: f.id, name: f.name, day: Number(f.day) || 1, amount: Number(f.amount) || 0, meta: [f.category, f.account].filter(Boolean).join(' · '), off: f.active === false })),
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
  ${section(`${mo + 1}월 출금 일정`, `<div class="panel list">${rows || empty('휴대폰 요금, 관리비, 보험료처럼 매달 나가는 돈을 추가해 보세요. 출금 하루 전에 알려드려요.')}</div>`, { action: addBtn('fixed') })}
  </div><div class="col-side">
  ${s.categories.length ? section('분류별', `<div class="panel list">${s.categories.map((c) => `<div class="row static bar-row">
      <span class="row-title">${esc(c.name)}</span>
      <span class="bar"><span style="width:${(c.amount / maxCat) * 100}%"></span></span>
      <span class="row-value">${wonExact(c.amount)}<small>${pct((c.amount / s.total) * 100, 0)}</small></span>
    </div>`).join('')}</div>`) : ''}
  </div></div>`;
}

// ───────────────────────── 기록 ─────────────────────────
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
      const isOpen = state.open.has(key) || (gi < 2 && !state.open.has(`${key}-closed`));
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
    }).join('') : `<div class="panel">${empty('아직 기록이 없어요. 위 버튼이나 자산 탭 계좌의 입금·출금 버튼으로 기록해 보세요.')}</div>`, { sum: `${list.length}건` })}


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
    ${vapid ? `<div class="pad"><button class="btn primary" data-action="push-enable">${p.devices.some((x) => x.token === mine) ? '이 기기 다시 등록' : '이 기기에서 알림 받기'}</button></div>` : ''}
    ${details('vapid', vapid ? '웹 푸시 키 바꾸기' : '처음 한 번: 웹 푸시 키 넣기', `<div class="pad">
      <p class="hint">Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서에서 <b>키 쌍 생성</b> 후 나온 키를 붙여 넣으세요. 공개용 키라 저장해도 안전해요.</p>
      <div class="inline"><input id="vapid" type="text" value="${esc(vapid)}" placeholder="B로 시작하는 긴 키" autocomplete="off"><button class="btn" data-action="vapid-save">저장</button></div>
    </div>`)}`;

  return `
  <div class="cols"><div class="col-main">
  ${section('비서 알림', `<div class="panel">
      <p class="pad">매일 오전 8시에 확인해서 <b>대출 상환일 5·3·1일 전</b>, <b>고정지출 출금 하루 전</b>에 휴대폰으로 알려드려요. 앱을 열면 홈의 '고정지출·상환 일정'에서도 볼 수 있어요.</p>
      ${pushBody}
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
  ${section('시세 자동 업데이트', `<div class="panel"><p class="pad">국내 주가와 환율은 평일 장중에 1시간마다 (오전 9시 13분~오후 3시 43분), 미국 주가는 매일 아침 6시 17분에 미국장 마감 가격으로, 주택 실거래가도 아침 6시 17분에 가져와요. GitHub 예약 실행이라 몇 분~십여 분 늦을 수 있어요. 지금 바로 받으려면 GitHub 저장소의 Actions → 주가·환율 장중 업데이트(또는 시세 자동 업데이트) → Run workflow를 누르세요.</p><p class="hint pad">주가·환율 ${dateTime(state.market?.quotesAt || state.market?.updatedAt)} · 주택 실거래가 ${dateTime(state.market?.updatedAt)}</p></div>`)}
  </div><div class="col-side">
  ${section('백업', `<div class="panel"><div class="pad actions">
      <button class="btn" data-action="export">백업 파일 받기</button>
      <label class="btn">백업 불러오기<input type="file" accept="application/json" id="import" hidden></label>
    </div></div>`)}
  ${section('계정', `<div class="panel list">
      <div class="row static"><span class="row-main"><span class="row-title">${esc(state.user?.email || '')}</span><span class="row-meta">앱 버전 ${esc(APP_VERSION)}</span></span><button class="link-btn" data-action="logout">${isDemo() ? '체험 끝내기' : '로그아웃'}</button></div>
    </div>`)}
  </div></div>`;
}

async function loadPush() {
  try {
    state.push = { loaded: true, supported: await store.pushSupported(), devices: await store.pushDevices() };
  } catch {
    state.push = { loaded: true, supported: false, devices: [] };
  }
  if (state.tab === 'settings') render();
}

// ───────────────────────── 그리기 ─────────────────────────
const VIEWS = { home: viewHome, assets: viewAssets, debts: viewDebts, fixed: viewFixed, records: viewRecords, settings: viewSettings };
const TITLES = { home: '홈', assets: '자산', debts: '부채', fixed: '고정지출', records: '기록', settings: '설정' };
const SYNC = { saving: '저장 중', saved: '동기화됨', offline: '오프라인', demo: '체험 모드' };

function render() {
  if (state.dragging) return; // 끄는 중에는 다시 그리지 않아요 (실시간 갱신이 와도)
  $('#login').hidden = !!state.user;
  $('#app').hidden = !state.user;
  if (!state.user) return;
  if (!VIEWS[state.tab]) state.tab = 'home';
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === state.tab ? 'page' : 'false'));
  renderSync();
  renderAlerts();
  $('#view').innerHTML = `<h1 class="page-title">${TITLES[state.tab]}${state.tab === 'assets' ? assetsTitleSum() : ''}</h1>${VIEWS[state.tab]()}`;
  afterRender();
}

// ───────────────────────── PC 알림 카드 ─────────────────────────
// 상환 5·3·1일 전, 고정지출 하루 전인 날에 오른쪽 아래에 떠서 닫을 때까지 남아 있어요.
// 닫은 알림은 이 기기에 기억해 두고, 다음 단계(예: 3일 전)가 되면 새로 떠요.
const DISMISS_KEY = 'chgok-alerts-closed';
const alertKey = (a) => `${a.type}:${a.id}:${ymd(a.date)}:${a.dday}`;
function closedAlerts() {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; }
}

function renderAlerts() {
  const box = $('#alerts');
  if (!state.user) { box.innerHTML = ''; return; }
  const closed = new Set(closedAlerts());
  const list = alertsFor(state.data, now()).filter((a) => !closed.has(alertKey(a)));
  box.innerHTML = list.map((a) => {
    const loan = a.type === 'loan';
    return `<div class="alert-card" role="alert">
      <div class="alert-head"><span class="badge hot">${loan ? `D-${a.dday}` : '내일'}</span><b>${loan ? `${esc(a.name)} 상환 ${a.dday}일 전` : `${esc(a.name)} 출금`}</b>
        <button class="icon-btn" data-close-alert="${esc(alertKey(a))}" aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <p>${mdw(a.date)} · ${a.exact ? '' : '약 '}${wonExact(a.amount)}${a.account ? ` · ${esc(a.account)}` : ''}</p>
      <a class="link-btn" href="#${loan ? 'debts' : 'fixed'}" data-close-alert="${esc(alertKey(a))}">${loan ? '부채에서 보기' : '고정지출에서 보기'}</a>
    </div>`;
  }).join('');
}

function renderSync() {
  document.querySelectorAll('.sync').forEach((el) => {
    el.textContent = SYNC[state.sync] || '';
    el.dataset.state = state.sync;
  });
}

function afterRender() {
  if (state.tab === 'home') {
    const c = $('#chart-trend');
    const mode = state.data.settings?.trendMode || 'day';
    if (c) trendChart(c, trend(state.history, state.data.snapshots, mode, now()).points, mode);
  }
  if (state.tab === 'assets') {
    for (const h of state.data.homes || []) {
      const mh = state.market.homes?.[h.id];
      const c = document.getElementById(`chart-home-${h.id}`);
      if (c && mh?.monthly) homeChart(c, mh.monthly.slice(-24));
    }
  }
  if (state.tab === 'settings' && !state.push.loaded && !isDemo()) loadPush();
}

// ───────────────────────── 입력창 ─────────────────────────
let editing = null;

function moneyText(val) {
  return val === '' || val == null ? '' : (Number(val) / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

function openForm(kind, item, preset = {}) {
  const spec = FORMS[kind];
  editing = { kind, id: item?.id };
  let v = item || {};
  editing.schedule = item?.schedule || null;
  if (kind === 'stocks' && !item) {
    const mk = state.stockTabShown || 'us';
    v = { market: mk, avgCur: mk === 'us' ? 'USD' : 'KRW', manualCur: mk === 'us' ? 'USD' : 'KRW' };
  }
  if (kind === 'stocks' && item) v = { avgCur: 'KRW', manualCur: 'KRW', market: stockMarket(item), ...item };
  if (kind === 'fx') v = { usdKrw: state.data.settings?.usdKrw || '' };
  if (isRecord(kind) && !item) {
    const list = state.data[kind === 'repayment' ? 'debts' : 'savings'] || [];
    const first = list.find((x) => x.id === preset.targetId) || list.filter((x) => !x.schedule?.length)[0];
    if (!first) return toast(kind === 'repayment' ? '직접 기록할 대출이 없어요. 상환스케줄을 불러온 대출은 자동으로 기록돼요.' : '먼저 자산에서 저축 계좌를 추가해 주세요.');
    v = { targetId: first.id, date: today(), ...recordDefaults(kind, first.id) };
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
    } else if (f.type === 'ref') {
      input = `<select id="${id}" name="${f.key}" required>${(state.data[f.source] || []).filter((o) => !f.filter || f.filter(o) || o.id === val).map((o) => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    } else if (f.type === 'date') {
      input = `<input id="${id}" name="${f.key}" type="date" value="${esc(val)}" required>`;
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
    else if (f.type === 'seg') out[f.key] = Number(el.value) || f.def;
    else out[f.key] = el.value.trim();
  }
  return out;
}

function saveForm() {
  const vals = readForm();
  const d = state.data;
  if (editing.kind === 'trade') return saveTrade(vals);
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
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 3200);
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
  if (m.typing) return `<div class="msg bot typing${pop}" aria-label="비서가 답을 쓰는 중"><i></i><i></i><i></i></div>`;
  const text = esc(m.text).replace(/\n/g, '<br>');
  if (m.me) return `<div class="msg me${pop}">${text}</div>`;
  // 질문에 대한 답이면 아래에 '이 답이 맞지 않았나요?'
  let fb = '';
  if (m.q && !m.unknown) {
    if (m.fb === 'sent') fb = '<p class="fb-done">개선 목록에 담았어요. 고맙습니다.</p>';
    else if (m.fb === 'open') fb = `<form class="fb-form" data-fb="${i}"><input type="text" placeholder="원래 뭘 알고 싶으셨어요? (선택)" aria-label="원래 알고 싶었던 것"><button type="submit" class="pill">담기</button></form>`;
    else fb = `<button type="button" class="fb" data-fb="${i}">이 답이 맞지 않았나요?</button>`;
  }
  if (m.unknown) fb = '<p class="fb-done">이 질문은 개선 목록에 자동으로 담겼어요.</p>';
  const after = pop ? ' fade-in' : '';
  return `<div class="msg bot${pop}">${text}</div>${fb ? fb.replace(/^<(\w+) class="/, `<$1 class="${after.trim()} `) : ''}${m.chips?.length ? `<div class="as-chips${after}">${m.chips.map((c) => `<button type="button" class="pill" data-q="${esc(c.q)}">${esc(c.label)}</button>`).join('')}</div>` : ''}`;
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
  const a = ask(q, state.data, state.market, new Date());
  // 모르는 질문은 저절로 개선 목록에
  if (a.unknown) saveFeedback({ q, kind: 'unknown' });
  replying = replying.then(async () => {
    if (!reduceMotion()) {
      await wait(180);
      const typing = { typing: true };
      chat.push(typing);
      renderChat();
      await wait(Math.min(1100, 450 + a.text.length * 6)); // 답이 길수록 조금 더 '쓰는' 시간
      chat.splice(chat.indexOf(typing), 1);
    }
    chat.push({ text: a.text, chips: a.chips, q, unknown: !!a.unknown });
    renderChat();
  });
}

function openAssistant() {
  if (!chat.length) chat.push({ text: '무엇이 궁금하세요? 입력해 두신 자산·대출·고정지출·주식 내용으로 바로 알려드릴게요.', chips: SUGGEST });
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
    if (chip) askAssistant(chip.dataset.q);
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

  $('#view').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action: a, kind, id } = b.dataset;
    if (a === 'add') openForm(kind);
    if (a === 'edit') openForm(kind, state.data[kind]?.find((x) => x.id === id));
    if (a === 'trade') openTrade(id, b.dataset.type);
    if (a === 'deposit') openForm(b.dataset.type, null, { targetId: id });
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
  }, true);

  $('#view').addEventListener('input', (e) => {
  });
  $('#view').addEventListener('change', async (e) => {
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

  const dlg = $('#editor');
  $('#editor-form').addEventListener('submit', (e) => { e.preventDefault(); if (saveForm() !== false) dlg.close(); });
  $('#editor-cancel').addEventListener('click', () => dlg.close());
  $('#editor-delete').addEventListener('click', () => deleteItem() && dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 바깥 누르면 닫기
  $('#editor-fields').addEventListener('click', (e) => {
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
    if (document.visibilityState === 'visible') { checkDay(); checkVersion(); }
    else if (newVersion && !$('#editor').open) location.reload();
  });
  setInterval(checkDay, 30_000);
  setInterval(checkVersion, 5 * 60_000);
}

async function main() {
  bind();
  store = await connect({
    onAuth: (u) => { state.user = u; state.push.loaded = false; render(); },
    onData: (d) => { state.data = { ...EMPTY(), ...(d || {}) }; refreshMarket(); render(); recordSnapshot(); recordDaily(); },
    onMarket: (m) => { state.marketRaw = m || {}; refreshMarket(); render(); recordSnapshot(); recordDaily(); },
    onSecrets: (sc) => { state.secrets = sc || {}; if (state.tab === 'settings') render(); },
    onHistory: (h) => { state.history = h || {}; state.historyLoaded = true; if (state.tab === 'home') render(); recordDaily(); },
    onSync: (s) => { state.sync = s; if (state.user) renderSync(); },
  });
  $('#boot').hidden = true;
  checkVersion();
}

main().catch((e) => {
  $('#boot').textContent = `불러오지 못했어요: ${e.message}`;
});
