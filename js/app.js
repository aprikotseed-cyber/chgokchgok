import { connect, isDemo } from './store.js?v=20261109d';
import { project, currentTotals, currentPayment, stockValue, homeValue, milestones, normTicker, loanThisMonth, graduatedInfo } from './projection.js?v=20261109d';
import { upsertRecord, deleteRecord, yearlySummary, monthlySummary, byTarget, today } from './records.js?v=20261109d';
import { upcoming, fixedSummary, nextDue, daysBetween, ALERT_DAYS } from './reminders.js?v=20261109d';
import { won, wonExact, pct, esc, ymLabel, dateTime, mdw } from './format.js?v=20261109d';
import { projectionChart, homeChart, redrawAll } from './charts.js?v=20261109d';

const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

const EMPTY = () => ({
  savings: [], stocks: [], stockPlan: { monthly: 0 }, homes: [], debts: [], fixed: [],
  settings: { horizon: 20 }, snapshots: {}, records: [],
});

const state = {
  user: null, data: EMPTY(), market: {}, sync: '',
  tab: location.hash.slice(1) || 'home',
  recYear: String(new Date().getFullYear()),
  day: today(),          // 날짜가 바뀌면 화면을 다시 그리기 위해 기억
  open: new Set(),       // 펼쳐 둔 <details> (실시간 갱신 때도 유지)
  push: { loaded: false, supported: false, devices: [] },
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

const FIXED_CATS = ['주거', '통신', '보험', '구독', '교통', '공과금', '교육', '기부·후원', '기타'];

const FORMS = {
  savings: {
    title: '저축·현금',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '주거래 적금', required: true },
      { key: 'kind', label: '종류', type: 'select', options: ['예금', '적금', '파킹통장', '연금', '청약', '보증금', '기타'] },
      { key: 'balance', label: '현재 잔액', type: 'money' },
      { key: 'monthly', label: '매달 넣는 돈', type: 'money' },
      { key: 'rate', label: '연 이자율', type: 'pct' },
    ],
  },
  stocks: {
    title: '주식 종목',
    fields: [
      { key: 'name', label: '종목 이름', type: 'text', placeholder: '삼성전자', required: true },
      { key: 'ticker', label: '종목코드', type: 'text', placeholder: '005930 또는 AAPL', hint: '국내는 6자리 코드, 해외는 티커. 매일 아침 시세를 가져와요' },
      { key: 'qty', label: '보유 수량', type: 'number', unit: '주' },
      { key: 'avgPrice', label: '평균 매수가', type: 'won', hint: '수익률 계산용 (해외 주식도 원화로)' },
      { key: 'manualPrice', label: '수동 현재가', type: 'won', hint: '자동 시세가 없을 때만 사용해요' },
    ],
  },
  stockPlan: {
    title: '주식 투자 계획',
    fields: [{ key: 'monthly', label: '매달 추가 투자', type: 'money' }],
  },
  homes: {
    title: '집',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '우리 집', required: true },
      { key: 'lawdCd', label: '시군구', type: 'sigungu', hint: '목록에 없으면 법정동코드 앞 5자리를 입력하세요' },
      { key: 'aptName', label: '단지명', type: 'text', placeholder: '한솔마을', hint: '실거래가 신고 이름의 일부만 써도 돼요' },
      { key: 'area', label: '전용면적', type: 'number', unit: '㎡', hint: '±2㎡ 안의 거래만 써요 (84타입이면 84)' },
      { key: 'share', label: '내 지분', type: 'pct', def: 100 },
      { key: 'useAuto', label: '실거래가로 시세 자동 반영', type: 'check', def: true },
      { key: 'manualPrice', label: '직접 입력 시세', type: 'money', hint: '자동 시세를 끄거나 아직 거래가 없을 때 사용' },
    ],
  },
  debts: {
    title: '대출',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '아낌e보금자리론', required: true },
      { key: 'kind', label: '종류', type: 'select', options: ['주택담보대출', '신용대출', '교직원공제회', '기타'] },
      { key: 'original', label: '처음 빌린 금액', type: 'money', hint: '상환 진행률 표시용 (선택)' },
      { key: 'balance', label: '현재 남은 원금', type: 'money' },
      { key: 'rate', label: '연 금리', type: 'pct' },
      { key: 'method', label: '상환 방식', type: 'select', options: [['annuity', '원리금균등'], ['equal', '원금균등'], ['graduated', '체증식'], ['bullet', '만기일시']] },
      { key: 'payment', label: '이번 달 원리금', type: 'money', showIf: { method: 'graduated' }, hint: '은행 앱·상환 스케줄표의 이번 달 납입액. 이걸로 매달 늘어나는 금액을 계산해요' },
      { key: 'payDay', label: '매달 상환일', type: 'day', hint: '상환일 5·3·1일 전에 알려드려요' },
      { key: 'maturity', label: '만기', type: 'month' },
      { key: 'graceEnd', label: '거치기간 끝 (선택)', type: 'month', hint: '이때까지는 이자만 내요' },
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
    title: '저축 기록',
    fields: [
      { key: 'targetId', label: '계좌', type: 'ref', source: 'savings' },
      { key: 'date', label: '날짜', type: 'date', hint: '오늘 날짜가 들어가 있어요. 빠뜨린 예전 기록은 날짜만 바꾸면 돼요' },
      { key: 'amount', label: '저축한 금액', type: 'money' },
      { key: 'kind', label: '구분', type: 'select', options: ['정기 납입', '추가 납입'] },
      { key: 'memo', label: '메모', type: 'text', placeholder: '선택' },
      { key: 'applied', label: '계좌 잔액에 더하기', type: 'check', def: true, hint: '잔액에 이미 포함된 예전 기록이면 끄세요' },
    ],
  },
  repayment: {
    title: '상환 기록',
    fields: [
      { key: 'targetId', label: '대출', type: 'ref', source: 'debts' },
      { key: 'date', label: '날짜', type: 'date', hint: '오늘 날짜가 들어가 있어요. 빠뜨린 예전 기록은 날짜만 바꾸면 돼요' },
      { key: 'amount', label: '갚은 원금', type: 'money', hint: '이번 달 예상 원금이에요. 은행 내역대로 고치면 돼요' },
      { key: 'interest', label: '함께 낸 이자', type: 'money' },
      { key: 'kind', label: '구분', type: 'select', options: ['정기 상환', '중도 상환'] },
      { key: 'memo', label: '메모', type: 'text', placeholder: '선택' },
      { key: 'applied', label: '대출 잔액에서 빼기', type: 'check', def: true, hint: '잔액에 이미 반영된 예전 기록이면 끄세요' },
    ],
  },
};
const isRecord = (kind) => kind === 'saving' || kind === 'repayment';
const METHOD = { annuity: '원리금균등', equal: '원금균등', graduated: '체증식', bullet: '만기일시' };

/** 계좌·대출을 고르면 미리 채울 금액 */
function recordDefaults(type, targetId) {
  if (type === 'saving') {
    const s = (state.data.savings || []).find((x) => x.id === targetId);
    return { amount: Number(s?.monthly) || '', kind: '정기 납입' };
  }
  const l = (state.data.debts || []).find((x) => x.id === targetId);
  if (!l) return {};
  const m = loanThisMonth(l);
  return { amount: Math.round(m.principal / 100) * 100, interest: Math.round(m.interest / 100) * 100, kind: '정기 상환' };
}

// ───────────────────────── 저장 ─────────────────────────
let saveTimer;
function commit() {
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.save(JSON.parse(JSON.stringify(state.data))).catch((e) => toast(`저장하지 못했어요: ${e.message}`)), 300);
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
function row({ kind, id, title, meta = '', value = '', sub = '', cls = '', action = 'edit' }) {
  return `<button class="row ${cls}" data-action="${action}" data-kind="${kind}" data-id="${esc(id)}">
    <span class="row-main"><span class="row-title">${title}</span>${meta ? `<span class="row-meta">${meta}</span>` : ''}</span>
    <span class="row-side"><span class="row-value">${value}</span>${sub ? `<span class="row-meta">${sub}</span>` : ''}</span>
  </button>`;
}

function section(title, body, { sum = '', action = '' } = {}) {
  return `<section class="block">
    <header class="block-head"><h2>${title}${sum ? `<span class="sum">${sum}</span>` : ''}</h2>${action}</header>
    ${body}
  </section>`;
}

const addBtn = (kind, label = '추가') => `<button class="link-btn" data-action="add" data-kind="${kind}">+ ${label}</button>`;
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

  const horizon = d.settings?.horizon || 20;
  const { points } = project(d, state.market, { years: horizon });
  const ms = milestones(points);
  const mText = [];
  if (ms.debtFreeYear !== undefined) mText.push(ms.debtFreeYear ? `${ms.debtFreeYear}년에 대출을 모두 갚아요` : `${horizon}년 안에는 대출이 남아요`);
  if (ms.nextNet?.year) mText.push(`총자산 ${won(ms.nextNet.target)} 돌파 ${ms.nextNet.year}년`);

  const soon = upcoming(d, now(), 14);
  const noPayDay = (d.debts || []).some((l) => l.balance > 0 && !l.payDay);

  return `
  ${isEmpty ? `<p class="notice">아직 입력된 자산이 없어요. <a href="#assets">자산</a>과 <a href="#debts">부채</a>에서 하나씩 추가해 보세요.</p>` : ''}
  <section class="hero">
    <div class="eyebrow">총자산</div>
    <div class="hero-num">${won(t.net)}</div>
    ${diff != null ? `<div class="delta ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${won(Math.abs(diff))}<span>${ymLabel(prevKey)} 대비</span></div>` : ''}
  </section>

  <section class="panel stats">
    <a class="stat" href="#assets"><span class="eyebrow">저축액${t.stocks ? ' · 주식 포함' : ''}</span><span class="stat-num">${won(saved)}</span></a>
    <span class="stat-op">+</span>
    <a class="stat" href="#assets"><span class="eyebrow">아파트</span><span class="stat-num">${won(t.homes)}</span></a>
    <span class="stat-op">−</span>
    <a class="stat" href="#debts"><span class="eyebrow">대출잔액</span><span class="stat-num">${won(t.debts)}</span><span class="stat-sub">이번 달 상환 ${won(pay)}</span></a>
  </section>

  ${section('다가오는 2주', `<div class="panel list">${soon.length ? soon.map(scheduleRow).join('') : empty('2주 안에 나갈 대출 상환이나 고정지출이 없어요.')}</div>
    ${noPayDay ? '<p class="hint">상환일이 없는 대출이 있어요. 부채에서 매달 상환일을 넣으면 일정과 알림에 나와요.</p>' : ''}`,
    { action: '<a class="link-btn" href="#fixed">고정지출 전체</a>' })}

  ${section('연도별 예상', `<div class="panel chart-panel">
      <div class="chart-top">
        <ul class="legend">
          <li><i style="background:var(--series-1)"></i>저축액</li>
          <li><i style="background:var(--series-2)"></i>대출잔액</li>
          <li><i style="background:var(--series-3)"></i>총자산</li>
        </ul>
        <label class="range"><input type="range" id="horizon" min="5" max="40" step="1" value="${horizon}" aria-label="예측 기간"><output id="horizon-val">${horizon}년</output></label>
      </div>
      <div class="chart-box"><canvas id="chart-projection" role="img" aria-label="연도별 저축액, 대출잔액, 총자산 예측"></canvas></div>
      ${mText.length ? `<p class="caption">${mText.join(' · ')}</p>` : ''}
      ${details('home-table', '표로 보기', `<div class="table-scroll"><table>
        <thead><tr><th>연도</th><th>저축액</th><th>아파트</th><th>대출잔액</th><th>총자산</th></tr></thead>
        <tbody>${points.map((p) => `<tr><th>${p.label === '현재' ? '지금' : `${p.year}년 말`}</th><td>${won(p.savings + p.stocks)}</td><td>${won(p.homes)}</td><td>${won(p.debts)}</td><td>${won(p.net)}</td></tr>`).join('')}</tbody>
      </table></div>`)}
    </div>
    <p class="hint">저축은 매달 적립과 이자, 대출은 상환 방식대로 계산해요. 아파트·주식은 지금 시세 그대로 둬요.</p>`)}`;
}

function scheduleRow(u) {
  const hot = ALERT_DAYS[u.type].includes(u.dday) || u.dday === 0;
  return row({
    kind: u.type === 'loan' ? 'debts' : 'fixed', id: u.id,
    title: `<span class="badge ${hot ? 'hot' : ''}">${dday(u.dday)}</span>${esc(u.name)}`,
    meta: `${mdw(u.date)} · ${u.type === 'loan' ? '대출 상환' : '고정지출'}`,
    value: u.type === 'loan' ? won(u.amount) : wonExact(u.amount),
  });
}

// ───────────────────────── 자산 ─────────────────────────
function viewAssets() {
  const d = state.data;
  const m = state.market;
  const t = currentTotals(d, m);

  const sav = (d.savings || []).map((s) => row({
    kind: 'savings', id: s.id, title: esc(s.name),
    meta: [s.kind, s.monthly ? `매달 ${won(s.monthly)}` : '', s.rate ? `연 ${pct(s.rate)}` : ''].filter(Boolean).join(' · '),
    value: won(s.balance),
  })).join('');

  const stk = (d.stocks || []).map((s) => {
    const q = m.stocks?.[normTicker(s.ticker)];
    const v = stockValue(s, m);
    const cost = (Number(s.avgPrice) || 0) * (Number(s.qty) || 0);
    const ret = cost ? ((v - cost) / cost) * 100 : null;
    const price = q?.price ? (q.currency === 'KRW' ? wonExact(q.price) : `${q.price.toLocaleString()} ${q.currency}`) : s.manualPrice ? `${wonExact(s.manualPrice)} (수동)` : '시세 대기';
    return row({
      kind: 'stocks', id: s.id, title: esc(s.name),
      meta: `${esc(s.ticker || '')} · ${Number(s.qty || 0).toLocaleString()}주 · ${price}${q?.error ? ` · <span class="warn">${esc(q.error)}</span>` : ''}`,
      value: won(v),
      sub: ret != null ? `<span class="${ret >= 0 ? 'up' : 'down'}">${ret >= 0 ? '+' : ''}${pct(ret)}</span>` : '',
    });
  }).join('');

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
    return row({
      kind: 'homes', id: h.id, title: esc(h.name),
      meta: [esc(h.aptName || ''), h.area ? `${h.area}㎡` : '', (h.share ?? 100) < 100 ? `지분 ${pct(h.share, 0)}` : '', status].filter(Boolean).join(' · '),
      value: won(homeValue(h, m)),
    }) + extra;
  }).join('');

  const plan = d.stockPlan || {};
  return `
  ${section('저축·현금', `<div class="panel list">${sav || empty('예금, 적금, 연금, 보증금 등을 추가해 보세요.')}</div>`, { sum: won(t.savings), action: addBtn('savings') })}
  ${section('주식', `<div class="panel list">
      ${row({ kind: 'stockPlan', id: 'plan', action: 'plan', title: '매달 추가 투자', value: won(plan.monthly || 0), cls: 'muted-row' })}
      ${stk || empty('종목코드와 수량만 넣으면 매일 아침 시세가 반영돼요.')}
    </div>`, { sum: won(t.stocks), action: addBtn('stocks', '종목') })}
  ${section('아파트', `<div class="panel list">${homes || empty('단지명과 전용면적을 넣으면 국토부 실거래가로 시세가 반영돼요.')}</div>`, { sum: won(t.homes), action: addBtn('homes') })}
  ${m.updatedAt ? `<p class="hint center">시세 업데이트 ${dateTime(m.updatedAt)}</p>` : ''}`;
}

// ───────────────────────── 부채 ─────────────────────────
function viewDebts() {
  const d = state.data;
  const t = currentTotals(d, state.market);
  const pay = (d.debts || []).reduce((a, l) => a + currentPayment(l), 0);
  const list = (d.debts || []).map((l) => {
    const orig = Number(l.original) || 0;
    const done = orig ? Math.min(100, Math.max(0, ((orig - l.balance) / orig) * 100)) : null;
    const g = l.method === 'graduated' ? graduatedInfo(l) : null;
    const next = l.payDay ? nextDue(l.payDay, now()) : null;
    const meta = [
      l.kind, METHOD[l.method], `연 ${pct(l.rate, 2)}`, `만기 ${ymLabel(l.maturity)}`,
      l.graceEnd ? `거치 ${ymLabel(l.graceEnd)}까지` : '',
    ].filter(Boolean).join(' · ');
    const lines = [
      next ? `다음 상환 ${mdw(next)} · 약 ${won(currentPayment(l))}` : `이번 달 약 ${won(currentPayment(l))} · <span class="warn">상환일 미입력</span>`,
      l.method === 'graduated' ? (g ? `매달 약 ${Math.round(g.step).toLocaleString()}원씩 늘어 마지막 회차 약 ${won(g.last)}` : '<span class="warn">이번 달 원리금을 넣어야 체증식으로 계산해요</span>') : '',
    ].filter(Boolean).map((x) => `<span class="row-meta">${x}</span>`).join('');
    return `<button class="row stack" data-action="edit" data-kind="debts" data-id="${esc(l.id)}">
      <span class="row-line"><span class="row-title">${esc(l.name)}</span><span class="row-value">${won(l.balance)}</span></span>
      <span class="row-meta">${meta}</span>${lines}
      ${done != null ? `<span class="progress" role="progressbar" aria-valuenow="${done.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="상환 진행률"><span style="width:${done}%"></span></span><span class="row-meta">${won(orig)} 중 ${pct(done, 0)} 상환</span>` : ''}
    </button>`;
  }).join('');
  return `
  <section class="panel stats">
    <div class="stat"><span class="eyebrow">대출잔액</span><span class="stat-num">${won(t.debts)}</span></div>
    <div class="stat"><span class="eyebrow">이번 달 상환 (원금+이자)</span><span class="stat-num">${won(pay)}</span></div>
  </section>
  ${section('대출', `<div class="panel list">${list || empty('대출을 추가하면 상환 방식대로 연도별 잔액을 계산하고, 상환일 전에 알려드려요.')}</div>`, { action: addBtn('debts') })}`;
}

// ───────────────────────── 고정지출 ─────────────────────────
function viewFixed() {
  const d = state.data;
  const t0 = now();
  const s = fixedSummary(d.fixed, t0);
  const loanPay = (d.debts || []).filter((l) => l.balance > 0).reduce((a, l) => a + currentPayment(l), 0);
  const nextOne = upcoming({ fixed: d.fixed }, t0, 31)[0];

  // 이번 달 달력 순서: 고정지출 + 상환일이 있는 대출
  const y = t0.getFullYear();
  const mo = t0.getMonth();
  const last = new Date(y, mo + 1, 0).getDate();
  const items = [
    ...(d.fixed || []).map((f) => ({ kind: 'fixed', id: f.id, name: f.name, day: Number(f.day) || 1, amount: Number(f.amount) || 0, meta: [f.category, f.account].filter(Boolean).join(' · '), off: f.active === false })),
    ...(d.debts || []).filter((l) => l.payDay && l.balance > 0).map((l) => ({ kind: 'debts', id: l.id, name: l.name, day: Number(l.payDay), amount: currentPayment(l), meta: '대출 상환', loan: true })),
  ].map((x) => ({ ...x, eff: Math.min(x.day, last) })).sort((a, b) => a.eff - b.eff || (a.loan ? -1 : 1));

  const todayNum = t0.getDate();
  const rows = items.map((x) => {
    const passed = x.eff < todayNum;
    const left = x.eff - todayNum;
    return `<button class="row cal ${passed || x.off ? 'dim' : ''}" data-action="edit" data-kind="${x.kind}" data-id="${esc(x.id)}">
      <span class="cal-day">${x.eff}<small>일</small></span>
      <span class="row-main"><span class="row-title">${esc(x.name)}</span><span class="row-meta">${esc(x.meta)}${x.off ? ' · 멈춤' : ''}</span></span>
      <span class="row-side"><span class="row-value">${x.loan ? won(x.amount) : wonExact(x.amount)}</span><span class="row-meta">${x.off ? '' : passed ? '출금됨' : left === 0 ? '오늘' : `D-${left}`}</span></span>
    </button>`;
  }).join('');

  const maxCat = Math.max(1, ...s.categories.map((c) => c.amount));
  return `
  <section class="hero">
    <div class="eyebrow">매달 고정지출</div>
    <div class="hero-num">${wonExact(s.total)}</div>
    <div class="hero-sub">${s.count}건 · 대출 상환까지 합치면 ${won(s.total + loanPay)}</div>
  </section>
  <section class="panel stats">
    <div class="stat"><span class="eyebrow">${mo + 1}월에 남은 출금</span><span class="stat-num">${wonExact(s.remaining)}</span></div>
    <div class="stat"><span class="eyebrow">다음 출금</span><span class="stat-num">${nextOne ? `${esc(nextOne.name)}` : '-'}</span>${nextOne ? `<span class="stat-sub">${mdw(nextOne.date)} · ${dday(nextOne.dday)}</span>` : ''}</div>
  </section>
  ${section(`${mo + 1}월 출금 일정`, `<div class="panel list">${rows || empty('휴대폰 요금, 관리비, 보험료처럼 매달 나가는 돈을 추가해 보세요. 출금 하루 전에 알려드려요.')}</div>`, { action: addBtn('fixed') })}
  ${s.categories.length ? section('분류별', `<div class="panel list">${s.categories.map((c) => `<div class="row static bar-row">
      <span class="row-title">${esc(c.name)}</span>
      <span class="bar"><span style="width:${(c.amount / maxCat) * 100}%"></span></span>
      <span class="row-value">${wonExact(c.amount)}<small>${pct((c.amount / s.total) * 100, 0)}</small></span>
    </div>`).join('')}</div>`) : ''}`;
}

// ───────────────────────── 기록 ─────────────────────────
function viewRecords() {
  const d = state.data;
  const recs = d.records || [];
  const nameOf = (r) => (d[r.type === 'saving' ? 'savings' : 'debts'] || []).find((x) => x.id === r.targetId)?.name || '(삭제된 항목)';
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
    <button class="btn primary" data-action="add-rec" data-type="saving">저축 기록</button>
    <button class="btn" data-action="add-rec" data-type="repayment">상환 기록</button>
  </div>
  <div class="segment" role="tablist" aria-label="연도">${years.map((y) => `<button role="tab" aria-selected="${y === year}" data-action="year" data-year="${y}">${y}</button>`).join('')}</div>
  <section class="panel stats three">
    <div class="stat"><span class="eyebrow">저축</span><span class="stat-num">${won(ys.saving)}</span></div>
    <div class="stat"><span class="eyebrow">상환 원금</span><span class="stat-num">${won(ys.principal)}</span></div>
    <div class="stat"><span class="eyebrow">낸 이자</span><span class="stat-num">${won(ys.interest)}</span></div>
  </section>

  ${section(`${year}년 월별`, `<div class="panel"><div class="table-scroll"><table>
      <thead><tr><th>월</th><th>저축</th><th>상환 원금</th><th>이자</th></tr></thead>
      <tbody>${months.map((m) => `<tr class="${m.count ? '' : 'dim'}"><th>${m.month}월</th><td>${cell(m.saving)}</td><td>${cell(m.principal)}</td><td>${cell(m.interest)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td>${won(ys.saving)}</td><td>${won(ys.principal)}</td><td>${won(ys.interest)}</td></tr></tfoot>
    </table></div></div>`)}

  ${targets.length ? section(`${year}년 항목별`, `<div class="panel list">${targets.map((x) => `<div class="row static">
      <span class="row-main"><span class="row-title">${esc(nameOf(x))}</span><span class="row-meta">${x.type === 'saving' ? '저축' : '상환'} ${x.count}회</span></span>
      <span class="row-side"><span class="row-value">${won(x.type === 'saving' ? x.saving : x.principal)}</span>${x.interest ? `<span class="row-meta">이자 ${won(x.interest)}</span>` : ''}</span>
    </div>`).join('')}</div>`) : ''}

  ${section(`${year}년 기록`, list.length ? Object.entries(groups).map(([ym, rs], gi) => {
      const key = `rec-${ym}`;
      const isOpen = state.open.has(key) || (gi < 2 && !state.open.has(`${key}-closed`));
      return `<details class="panel month" data-key="${key}" ${isOpen ? 'open' : ''}>
        <summary><b>${Number(ym.slice(5))}월</b><span>저축 ${won(sumOf(rs, 'saving'))} · 상환 ${won(sumOf(rs, 'repayment'))}</span></summary>
        <div class="list">${rs.map((r) => row({
          kind: 'record', id: r.id, action: 'edit-rec',
          title: `<span class="date">${Number(r.date.slice(8))}일</span>${esc(nameOf(r))}`,
          meta: [r.kind, r.applied === false ? '잔액 미반영' : '', esc(r.memo || '')].filter(Boolean).join(' · '),
          value: `${r.type === 'saving' ? '저축' : '상환'} ${won(r.amount)}`,
          sub: r.interest ? `이자 ${won(r.interest)}` : '',
        })).join('')}</div>
      </details>`;
    }).join('') : `<div class="panel">${empty('아직 기록이 없어요. 위 버튼으로 저축이나 상환을 기록해 보세요.')}</div>`, { sum: `${list.length}건` })}

  ${yearsAll.length ? section('연도별 합계', `<div class="panel"><div class="table-scroll"><table>
      <thead><tr><th>연도</th><th>저축</th><th>상환 원금</th><th>이자</th></tr></thead>
      <tbody>${yearsAll.map((y) => `<tr><th>${y.year}년</th><td>${won(y.saving)}</td><td>${won(y.principal)}</td><td>${won(y.interest)}</td></tr>`).join('')}</tbody>
    </table></div></div>`) : ''}`;
}

// ───────────────────────── 설정 ─────────────────────────
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
  ${section('비서 알림', `<div class="panel">
      <p class="pad">매일 오전 8시에 확인해서 <b>대출 상환일 5·3·1일 전</b>, <b>고정지출 출금 하루 전</b>에 휴대폰으로 알려드려요. 앱을 열면 대시보드의 '다가오는 2주'에서도 볼 수 있어요.</p>
      ${pushBody}
    </div>`)}
  ${section('시세 자동 업데이트', `<div class="panel"><p class="pad">매일 오전 6시에 실거래가와 주가를 가져와요. 지금 바로 받으려면 GitHub 저장소의 Actions → 시세 자동 업데이트 → Run workflow를 누르세요.</p><p class="hint pad">마지막 업데이트 ${dateTime(state.market?.updatedAt)}</p></div>`)}
  ${section('백업', `<div class="panel"><div class="pad actions">
      <button class="btn" data-action="export">백업 파일 받기</button>
      <label class="btn">백업 불러오기<input type="file" accept="application/json" id="import" hidden></label>
    </div></div>`)}
  ${section('계정', `<div class="panel list">
      <div class="row static"><span class="row-main"><span class="row-title">${esc(state.user?.email || '')}</span><span class="row-meta">앱 버전 ${esc(APP_VERSION)}</span></span><button class="link-btn" data-action="logout">${isDemo() ? '체험 끝내기' : '로그아웃'}</button></div>
    </div>`)}`;
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
const SYNC = { saving: '저장 중', saved: '동기화됨', offline: '오프라인', demo: '체험 모드' };

function render() {
  $('#login').hidden = !!state.user;
  $('#app').hidden = !state.user;
  if (!state.user) return;
  if (!VIEWS[state.tab]) state.tab = 'home';
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === state.tab ? 'page' : 'false'));
  renderSync();
  $('#view').innerHTML = VIEWS[state.tab]();
  afterRender();
}

function renderSync() {
  const el = $('#sync');
  el.textContent = SYNC[state.sync] || '';
  el.dataset.state = state.sync;
}

function afterRender() {
  if (state.tab === 'home') {
    const { points } = project(state.data, state.market, { years: state.data.settings?.horizon || 20 });
    projectionChart($('#chart-projection'), points);
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

function openForm(kind, item) {
  const spec = FORMS[kind];
  editing = { kind, id: item?.id };
  let v = item || {};
  if (isRecord(kind) && !item) {
    const first = state.data[kind === 'saving' ? 'savings' : 'debts']?.[0];
    if (!first) return toast(kind === 'saving' ? '먼저 자산에서 저축 계좌를 추가해 주세요.' : '먼저 부채에서 대출을 추가해 주세요.');
    v = { targetId: first.id, date: today(), ...recordDefaults(kind, first.id) };
  }
  $('#editor-title').textContent = kind === 'stockPlan' ? spec.title : `${spec.title} ${item ? '수정' : '추가'}`;
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
    } else if (f.type === 'pct') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="number" step="0.01" inputmode="decimal" value="${val}"><span>%</span></div>`;
    } else if (f.type === 'day') {
      input = `<select id="${id}" name="${f.key}"><option value="">선택 안 함</option>${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${Number(val) === n ? 'selected' : ''}>${n}일</option>`).join('')}</select>`;
    } else if (f.type === 'ref') {
      input = `<select id="${id}" name="${f.key}" required>${(state.data[f.source] || []).map((o) => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
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
    const show = f.showIf ? ` data-show-key="${Object.keys(f.showIf)[0]}" data-show-val="${Object.values(f.showIf)[0]}"` : '';
    return `<div class="field"${show}><label for="${id}">${f.label}</label>${input}${hint}</div>`;
  }).join('');
  $('#editor-delete').hidden = !item || kind === 'stockPlan';
  $('#editor').showModal();
  syncShowIf();
  $('#editor-fields').querySelectorAll('[data-money]').forEach(previewMoney);
  if (matchMedia('(hover: hover)').matches) $('#editor-fields input')?.focus();
}

function syncShowIf() {
  $('#editor-fields').querySelectorAll('[data-show-key]').forEach((el) => {
    el.hidden = $(`#f-${el.dataset.showKey}`)?.value !== el.dataset.showVal;
  });
}

const parseNum = (s) => Number(String(s).replace(/[^\d.\-]/g, '')) || 0;
const readMoney = (el) => Math.round(parseNum(el.value) * (el.dataset.money === 'won' ? 1 : 1e4));

function previewMoney(input) {
  const out = input.closest('.field').querySelector('.preview');
  const n = readMoney(input);
  out.textContent = n ? (input.dataset.money === 'won' ? wonExact(n) : won(n)) : '';
}

function readForm() {
  const out = {};
  for (const f of FORMS[editing.kind].fields) {
    const el = $(`#f-${f.key}`);
    if (f.type === 'check') out[f.key] = el.checked;
    else if (f.type === 'money' || f.type === 'won') out[f.key] = readMoney(el);
    else if (f.type === 'pct' || f.type === 'number') out[f.key] = el.value === '' ? (f.def ?? 0) : Number(el.value);
    else if (f.type === 'day') out[f.key] = el.value ? Number(el.value) : '';
    else out[f.key] = el.value.trim();
  }
  return out;
}

function saveForm() {
  const vals = readForm();
  const d = state.data;
  if (editing.kind === 'stockPlan') d.stockPlan = vals;
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

function bind() {
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
    if (a === 'plan') openForm('stockPlan', state.data.stockPlan || {});
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
    if (e.target.id === 'horizon') {
      $('#horizon-val').textContent = `${e.target.value}년`;
      state.data.settings = { ...(state.data.settings || {}), horizon: Number(e.target.value) };
      projectionChart($('#chart-projection'), project(state.data, state.market, { years: Number(e.target.value) }).points);
    }
  });
  $('#view').addEventListener('change', async (e) => {
    if (e.target.id === 'horizon') commit();
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
  $('#editor-form').addEventListener('submit', (e) => { e.preventDefault(); saveForm(); dlg.close(); });
  $('#editor-cancel').addEventListener('click', () => dlg.close());
  $('#editor-delete').addEventListener('click', () => deleteItem() && dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 바깥 누르면 닫기
  $('#editor-fields').addEventListener('input', (e) => {
    if (e.target.matches('[data-money]')) previewMoney(e.target);
    if (e.target.name === 'targetId' && !editing.id) {
      const v = recordDefaults(editing.kind, e.target.value);
      for (const k of ['amount', 'interest']) {
        const el = $(`#f-${k}`);
        if (el && v[k] !== undefined) { el.value = moneyText(v[k]); previewMoney(el); }
      }
    }
    syncShowIf();
    if (e.target.name === 'lawdCd') e.target.closest('.field').querySelector('output').textContent = SIGUNGU.find(([c]) => c === e.target.value)?.[1] || '';
  });

  $('#update-apply').addEventListener('click', () => location.reload());

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
    onData: (d) => { state.data = { ...EMPTY(), ...(d || {}) }; render(); recordSnapshot(); },
    onMarket: (m) => { state.market = m || {}; render(); recordSnapshot(); },
    onSync: (s) => { state.sync = s; if (state.user) renderSync(); },
  });
  $('#boot').hidden = true;
  checkVersion();
}

main().catch((e) => {
  $('#boot').textContent = `불러오지 못했어요: ${e.message}`;
});
