import { connect, isDemo } from './store.js';
import { project, currentTotals, currentPayment, stockValue, homeValue, milestones, normTicker } from './projection.js';
import { won, pct, esc, ymLabel, dateTime } from './format.js';
import { projectionChart, homeChart, redrawAll } from './charts.js';

const EMPTY = () => ({
  savings: [], stocks: [], stockPlan: { monthly: 0, rate: 5 }, homes: [], debts: [],
  settings: { horizon: 20 }, snapshots: {},
});

const state = { user: null, data: EMPTY(), market: {}, sync: '', tab: location.hash.slice(1) || 'home' };
let store;

// ───────────────────────── 입력 항목 정의 ─────────────────────────
const SIGUNGU = [
  ['41135', '성남시 분당구'], ['41131', '성남시 수정구'], ['41133', '성남시 중원구'],
  ['41465', '용인시 수지구'], ['41463', '용인시 기흥구'], ['41461', '용인시 처인구'],
  ['41117', '수원시 영통구'], ['41115', '수원시 팔달구'], ['41113', '수원시 권선구'], ['41111', '수원시 장안구'],
  ['41450', '하남시'], ['41610', '광주시'], ['41290', '과천시'], ['41430', '의왕시'],
  ['11680', '서울 강남구'], ['11650', '서울 서초구'], ['11710', '서울 송파구'], ['11740', '서울 강동구'],
  ['11440', '서울 마포구'], ['11170', '서울 용산구'], ['11200', '서울 성동구'], ['11215', '서울 광진구'],
  ['11590', '서울 동작구'], ['11560', '서울 영등포구'], ['11470', '서울 양천구'], ['11350', '서울 노원구'],
];

const FORMS = {
  savings: {
    title: '저축·현금',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '예: 주거래 적금', required: true },
      { key: 'kind', label: '종류', type: 'select', options: ['예금', '적금', '파킹통장', '연금', '청약', '보증금', '기타'] },
      { key: 'balance', label: '현재 잔액', type: 'money' },
      { key: 'monthly', label: '매달 넣는 돈', type: 'money', hint: '예측 그래프에서 매달 더해져요' },
      { key: 'rate', label: '연 이자율·수익률', type: 'pct' },
    ],
  },
  stocks: {
    title: '주식 종목',
    fields: [
      { key: 'name', label: '종목 이름', type: 'text', placeholder: '예: 삼성전자', required: true },
      { key: 'ticker', label: '종목코드', type: 'text', placeholder: '005930 또는 AAPL', hint: '국내는 6자리 코드, 해외는 티커. 매일 아침 시세를 자동으로 가져와요' },
      { key: 'qty', label: '보유 수량', type: 'number', unit: '주' },
      { key: 'avgPrice', label: '평균 매수가 (원)', type: 'number', unit: '원', hint: '수익률 계산용 (해외 주식도 원화로)' },
      { key: 'manualPrice', label: '수동 현재가 (원)', type: 'number', unit: '원', hint: '자동 시세가 없을 때만 사용해요' },
    ],
  },
  stockPlan: {
    title: '주식 투자 계획',
    fields: [
      { key: 'monthly', label: '매달 추가 투자', type: 'money' },
      { key: 'rate', label: '기대 연수익률', type: 'pct', hint: '보수적으로 4~6% 정도를 많이 써요' },
    ],
  },
  homes: {
    title: '집',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '예: 우리 집', required: true },
      { key: 'lawdCd', label: '시군구', type: 'sigungu', hint: '목록에 없으면 법정동코드 앞 5자리를 직접 입력하세요' },
      { key: 'aptName', label: '단지명', type: 'text', placeholder: '예: 한솔마을', hint: '실거래가 신고 이름의 일부만 써도 돼요' },
      { key: 'area', label: '전용면적', type: 'number', unit: '㎡', hint: '±2㎡ 안의 거래만 사용해요 (84타입이면 84)' },
      { key: 'share', label: '내 지분', type: 'pct', def: 100 },
      { key: 'useAuto', label: '실거래가로 자동 시세 반영', type: 'check', def: true },
      { key: 'manualPrice', label: '직접 입력 시세', type: 'money', hint: '자동 시세를 끄거나, 아직 거래가 없을 때 사용' },
      { key: 'growth', label: '예상 연 상승률', type: 'pct', def: 2, hint: '예측 그래프에만 쓰여요' },
    ],
  },
  debts: {
    title: '대출',
    fields: [
      { key: 'name', label: '이름', type: 'text', placeholder: '예: 주택담보대출', required: true },
      { key: 'kind', label: '종류', type: 'select', options: ['주택담보대출', '전세대출', '신용대출', '학자금대출', '기타'] },
      { key: 'original', label: '처음 빌린 금액', type: 'money', hint: '상환 진행률 표시용 (선택)' },
      { key: 'balance', label: '현재 남은 원금', type: 'money' },
      { key: 'rate', label: '연 금리', type: 'pct' },
      { key: 'method', label: '상환 방식', type: 'select', options: [['annuity', '원리금균등'], ['equal', '원금균등'], ['bullet', '만기일시']] },
      { key: 'maturity', label: '만기', type: 'month' },
      { key: 'graceEnd', label: '거치기간 끝 (선택)', type: 'month', hint: '이때까지는 이자만 내요' },
    ],
  },
};

const METHOD = { annuity: '원리금균등', equal: '원금균등', bullet: '만기일시' };

// ───────────────────────── 저장 ─────────────────────────
let saveTimer;
function commit() {
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.save(JSON.parse(JSON.stringify(state.data))).catch((e) => toast(`저장 실패: ${e.message}`)), 400);
}

/** 이번 달 합계를 기록해 두면 '지난달 대비' 변화를 볼 수 있어요 */
function recordSnapshot() {
  const t = currentTotals(state.data, state.market);
  if (!t.assets && !t.debts) return;
  const ym = new Date().toISOString().slice(0, 7);
  const prev = state.data.snapshots?.[ym];
  const next = { assets: Math.round(t.assets), debts: Math.round(t.debts), net: Math.round(t.net) };
  if (prev && prev.assets === next.assets && prev.debts === next.debts) return;
  state.data.snapshots = { ...(state.data.snapshots || {}), [ym]: next };
  commit();
}

// ───────────────────────── 화면 ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);

function render() {
  $('#login').hidden = !!state.user;
  $('#app').hidden = !state.user;
  if (!state.user) return;
  document.querySelectorAll('#tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === state.tab ? 'page' : 'false'));
  const sync = { saving: '저장 중…', saved: '동기화됨', offline: '오프라인 (나중에 동기화)', demo: '체험 모드' }[state.sync] || '';
  $('#sync').textContent = sync;
  $('#sync').dataset.state = state.sync;

  const view = $('#view');
  const views = { home: viewHome, assets: viewAssets, debts: viewDebts, settings: viewSettings };
  view.innerHTML = (views[state.tab] || viewHome)();
  afterRender();
}

function viewHome() {
  const d = state.data;
  const t = currentTotals(d, state.market);
  const horizon = d.settings?.horizon || 20;
  const { points } = project(d, state.market, { years: horizon });
  const ms = milestones(points);
  const ym = new Date().toISOString().slice(0, 7);
  const prevKey = Object.keys(d.snapshots || {}).filter((k) => k < ym).sort().pop();
  const diff = prevKey ? t.net - d.snapshots[prevKey].net : null;
  const pay = (d.debts || []).reduce((a, l) => a + currentPayment(l), 0);
  const empty = !t.assets && !t.debts;

  const mText = [];
  if (ms.debtFreeYear !== undefined) mText.push(ms.debtFreeYear ? `<b>${ms.debtFreeYear}년</b>에 빚을 모두 갚아요` : `${horizon}년 안에는 빚이 남아요`);
  if (ms.nextNet) mText.push(ms.nextNet.year ? `순자산 <b>${won(ms.nextNet.target)}</b> 돌파는 <b>${ms.nextNet.year}년</b> 예상` : '');

  const comp = [['저축·현금', t.savings, 'savings'], ['주식', t.stocks, 'stocks'], ['집', t.homes, 'homes']];
  const maxComp = Math.max(...comp.map((c) => c[1]), 1);

  return `
  ${empty ? `<div class="card notice">아직 입력된 자산이 없어요. <a href="#assets">자산</a>과 <a href="#debts">부채</a> 탭에서 하나씩 추가해 보세요.</div>` : ''}
  <section class="hero card">
    <div class="label">지금 순자산</div>
    <div class="hero-num">${won(t.net)}</div>
    ${diff != null ? `<div class="delta ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${won(Math.abs(diff))} <span>지난 기록(${ymLabel(prevKey)}) 대비</span></div>` : '<div class="delta"><span>매달 자동으로 기록돼서 다음 달부터 변화가 보여요</span></div>'}
  </section>
  <div class="tiles">
    <div class="card tile"><div class="label">총자산</div><div class="num">${won(t.assets)}</div></div>
    <div class="card tile"><div class="label">남은 빚</div><div class="num">${won(t.debts)}</div></div>
    <div class="card tile"><div class="label">이번 달 상환액</div><div class="num">${won(pay)}</div></div>
  </div>

  <section class="card">
    <div class="card-head">
      <h2>연도별 예상 자산과 잔여 채무</h2>
      <label class="range">
        <span><b id="horizon-val">${horizon}</b>년</span>
        <input type="range" id="horizon" min="5" max="40" step="1" value="${horizon}" aria-label="예측 기간(년)">
      </label>
    </div>
    <ul class="legend">
      <li><i style="background:var(--series-1)"></i>총자산</li>
      <li><i style="background:var(--series-2)"></i>잔여 채무</li>
      <li><i style="background:var(--series-3)"></i>순자산</li>
    </ul>
    <div class="chart-box"><canvas id="chart-projection" role="img" aria-label="연도별 총자산, 잔여 채무, 순자산 예측 꺾은선그래프"></canvas></div>
    ${mText.filter(Boolean).length ? `<p class="milestones">${mText.filter(Boolean).join(' · ')}</p>` : ''}
    <details class="table-view">
      <summary>표로 보기</summary>
      <div class="table-scroll"><table>
        <thead><tr><th>연도</th><th>저축·현금</th><th>주식</th><th>집</th><th>총자산</th><th>잔여 채무</th><th>순자산</th></tr></thead>
        <tbody>${points.map((p) => `<tr><th>${p.label === '현재' ? '지금' : `${p.year}년 말`}</th><td>${won(p.savings)}</td><td>${won(p.stocks)}</td><td>${won(p.homes)}</td><td><b>${won(p.assets)}</b></td><td>${won(p.debts)}</td><td><b>${won(p.net)}</b></td></tr>`).join('')}</tbody>
      </table></div>
    </details>
    <p class="fine">예측 가정: 저축은 매달 적립 + 연 이자, 주식은 기대수익률, 집은 예상 상승률, 대출은 상환 방식대로 갚는다고 계산해요. 대출 상환금이 저축에서 빠지는 것은 따로 반영하지 않아요.</p>
  </section>

  <section class="card">
    <h2>자산 구성</h2>
    <div class="bars">
      ${comp.map(([name, v]) => `
        <div class="bar-row">
          <span class="bar-name">${name}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(v / maxComp) * 100}%"></span></span>
          <span class="bar-val">${won(v)}<small>${t.assets ? pct((v / t.assets) * 100, 0) : ''}</small></span>
        </div>`).join('')}
    </div>
  </section>`;
}

function itemCard(kind, item, body, extra = '') {
  return `<article class="item" data-kind="${kind}" data-id="${esc(item.id)}">
    <button class="item-main" data-action="edit" aria-label="${esc(item.name)} 수정">${body}</button>${extra}
  </article>`;
}

function viewAssets() {
  const d = state.data;
  const m = state.market;
  const t = currentTotals(d, m);

  const sav = (d.savings || []).map((s) => itemCard('savings', s, `
    <div class="item-title">${esc(s.name)} <span class="chip">${esc(s.kind || '')}</span></div>
    <div class="item-num">${won(s.balance)}</div>
    <div class="item-sub">매달 ${won(s.monthly || 0)} · 연 ${pct(s.rate)}</div>`)).join('');

  const stk = (d.stocks || []).map((s) => {
    const q = m.stocks?.[normTicker(s.ticker)];
    const v = stockValue(s, m);
    const cost = (Number(s.avgPrice) || 0) * (Number(s.qty) || 0);
    const ret = cost ? ((v - cost) / cost) * 100 : null;
    const priceTxt = q?.price ? `${q.currency === 'KRW' ? `${Math.round(q.price).toLocaleString()}원` : `${q.price.toLocaleString()} ${q.currency}`}` : s.manualPrice ? `수동 ${Number(s.manualPrice).toLocaleString()}원` : '시세 대기 중';
    return itemCard('stocks', s, `
      <div class="item-title">${esc(s.name)} <span class="chip">${esc(s.ticker || '')}</span></div>
      <div class="item-num">${won(v)}${ret != null ? ` <span class="ret ${ret >= 0 ? 'up' : 'down'}">${ret >= 0 ? '+' : ''}${pct(ret)}</span>` : ''}</div>
      <div class="item-sub">${Number(s.qty || 0).toLocaleString()}주 · 현재가 ${priceTxt}${q?.error ? ` · <span class="warn">${esc(q.error)}</span>` : ''}</div>`);
  }).join('');

  const homes = (d.homes || []).map((h) => {
    const mh = m.homes?.[h.id];
    const auto = h.useAuto !== false;
    let status = '';
    if (!auto) status = '직접 입력한 시세를 사용 중';
    else if (mh?.estimate) status = `${esc(mh.basis || '')} · ${dateTime(mh.checkedAt)} 확인`;
    else status = '내일 아침 자동 수집 후 반영돼요';
    return itemCard('homes', h, `
      <div class="item-title">${esc(h.name)} <span class="chip">${esc(h.aptName || '')} ${h.area ? `${h.area}㎡` : ''}</span></div>
      <div class="item-num">${won(homeValue(h, m))}${(h.share ?? 100) < 100 ? ` <span class="chip">지분 ${pct(h.share, 0)}</span>` : ''}</div>
      <div class="item-sub">${status}</div>
      ${mh?.error && auto ? `<div class="item-sub warn">${esc(mh.error)}</div>` : ''}`,
    `${mh?.candidates?.length ? `<div class="item-extra"><div class="label">이 지역에서 찾은 단지 이름 (눌러서 바로 적용)</div><div class="cands">${mh.candidates.map((c) => `<button class="chip-btn" data-action="cand" data-name="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}
     ${auto && mh?.monthly?.length > 1 ? `<div class="item-extra"><div class="label">최근 실거래가 추이 (월별 중앙값)</div><div class="chart-box small"><canvas id="chart-home-${esc(h.id)}" role="img" aria-label="${esc(h.name)} 실거래가 추이"></canvas></div>
       <details class="table-view"><summary>최근 거래 ${mh.trades?.length || 0}건</summary><div class="table-scroll"><table><thead><tr><th>계약일</th><th>금액</th><th>층</th><th>면적</th></tr></thead><tbody>${(mh.trades || []).map((x) => `<tr><td>${x.date}</td><td>${won(x.price)}</td><td>${x.floor ?? '-'}</td><td>${x.area}㎡</td></tr>`).join('')}</tbody></table></div></details></div>` : ''}`);
  }).join('');

  const plan = d.stockPlan || {};
  return `
  <section class="section">
    <div class="section-head"><h2>저축·현금 <span class="sum">${won(t.savings)}</span></h2><button class="btn" data-action="add" data-kind="savings">+ 추가</button></div>
    <div class="items">${sav || '<p class="empty">예금, 적금, 연금, 전세보증금 등을 추가해 보세요.</p>'}</div>
  </section>
  <section class="section">
    <div class="section-head"><h2>주식 <span class="sum">${won(t.stocks)}</span></h2><button class="btn" data-action="add" data-kind="stocks">+ 종목</button></div>
    <button class="plan" data-action="plan">투자 계획: 매달 <b>${won(plan.monthly || 0)}</b> 추가 · 기대수익률 <b>연 ${pct(plan.rate)}</b> <span>수정</span></button>
    <div class="items">${stk || '<p class="empty">종목코드와 수량만 넣으면 매일 아침 시세가 자동으로 반영돼요.</p>'}</div>
  </section>
  <section class="section">
    <div class="section-head"><h2>집 <span class="sum">${won(t.homes)}</span></h2><button class="btn" data-action="add" data-kind="homes">+ 추가</button></div>
    <div class="items">${homes || '<p class="empty">단지명과 전용면적을 넣으면 국토부 실거래가로 시세가 자동 반영돼요.</p>'}</div>
  </section>
  ${m.updatedAt ? `<p class="fine center">시세 자동 업데이트: ${dateTime(m.updatedAt)}</p>` : ''}`;
}

function viewDebts() {
  const d = state.data;
  const t = currentTotals(d, state.market);
  const pay = (d.debts || []).reduce((a, l) => a + currentPayment(l), 0);
  const list = (d.debts || []).map((l) => {
    const orig = Number(l.original) || 0;
    const done = orig ? Math.min(100, Math.max(0, ((orig - l.balance) / orig) * 100)) : null;
    return itemCard('debts', l, `
      <div class="item-title">${esc(l.name)} <span class="chip">${METHOD[l.method] || ''}</span></div>
      <div class="item-num">${won(l.balance)}</div>
      <div class="item-sub">연 ${pct(l.rate, 2)} · 이번 달 약 ${won(currentPayment(l))} · 만기 ${ymLabel(l.maturity)}${l.graceEnd ? ` · 거치 ${ymLabel(l.graceEnd)}까지` : ''}</div>
      ${done != null ? `<div class="progress" role="progressbar" aria-valuenow="${done.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${done}%"></span></div><div class="item-sub">${won(orig)} 중 ${pct(done, 0)} 상환</div>` : ''}`);
  }).join('');
  return `
  <div class="tiles two">
    <div class="card tile"><div class="label">남은 빚 합계</div><div class="num">${won(t.debts)}</div></div>
    <div class="card tile"><div class="label">이번 달 상환액 (원금+이자)</div><div class="num">${won(pay)}</div></div>
  </div>
  <section class="section">
    <div class="section-head"><h2>대출</h2><button class="btn" data-action="add" data-kind="debts">+ 추가</button></div>
    <div class="items">${list || '<p class="empty">주택담보대출, 신용대출 등을 추가해 보세요. 상환 방식과 만기를 넣으면 연도별 잔액을 계산해요.</p>'}</div>
  </section>`;
}

function viewSettings() {
  return `
  <section class="card">
    <h2>계정</h2>
    <p>${esc(state.user?.email || '')}</p>
    <button class="btn ghost" data-action="logout">${isDemo() ? '체험 끝내기' : '로그아웃'}</button>
  </section>
  <section class="card">
    <h2>시세 자동 업데이트</h2>
    <p>매일 오전 6시에 GitHub Actions가 실거래가와 주가를 가져와요. 바로 업데이트하려면 GitHub 저장소의 <b>Actions → 시세 자동 업데이트 → Run workflow</b>를 누르세요.</p>
    <p class="fine">마지막 업데이트: ${dateTime(state.market?.updatedAt)}</p>
  </section>
  <section class="card">
    <h2>백업</h2>
    <p>데이터는 Firebase에 자동 저장되지만, 가끔 파일로도 받아두면 안심이에요.</p>
    <div class="row">
      <button class="btn" data-action="export">백업 파일 받기</button>
      <label class="btn ghost">백업 불러오기<input type="file" accept="application/json" id="import" hidden></label>
    </div>
  </section>`;
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
}

// ───────────────────────── 입력 폼 ─────────────────────────
let editing = null;

function openForm(kind, item) {
  const spec = FORMS[kind];
  editing = { kind, id: item?.id };
  const v = item || {};
  $('#editor-title').textContent = `${spec.title} ${kind === 'stockPlan' ? '' : item ? '수정' : '추가'}`;
  $('#editor-fields').innerHTML = spec.fields.map((f) => {
    const val = v[f.key] ?? f.def ?? '';
    const id = `f-${f.key}`;
    const hint = f.hint ? `<small>${f.hint}</small>` : '';
    if (f.type === 'check') return `<label class="field check"><input type="checkbox" id="${id}" name="${f.key}" ${val ? 'checked' : ''}><span>${f.label}</span>${hint}</label>`;
    let input;
    if (f.type === 'select') {
      input = `<select id="${id}" name="${f.key}">${f.options.map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${k}" ${k === val ? 'selected' : ''}>${l}</option>`; }).join('')}</select>`;
    } else if (f.type === 'money') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="text" inputmode="numeric" value="${val === '' ? '' : (Number(val) / 1e4).toLocaleString()}" data-money placeholder="0"><span>만원</span></div><output class="money-preview" for="${id}"></output>`;
    } else if (f.type === 'pct') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="number" step="0.01" inputmode="decimal" value="${val}"><span>%</span></div>`;
    } else if (f.type === 'month') {
      input = `<input id="${id}" name="${f.key}" type="month" value="${esc(val)}">`;
    } else if (f.type === 'sigungu') {
      input = `<input id="${id}" name="${f.key}" list="sigungu-list" inputmode="numeric" value="${esc(val)}" placeholder="41135"><datalist id="sigungu-list">${SIGUNGU.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</datalist><output class="money-preview">${SIGUNGU.find(([c]) => c === val)?.[1] || ''}</output>`;
    } else if (f.type === 'number') {
      input = `<div class="unit"><input id="${id}" name="${f.key}" type="number" step="any" inputmode="decimal" value="${val}"><span>${f.unit || ''}</span></div>`;
    } else {
      input = `<input id="${id}" name="${f.key}" type="text" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>`;
    }
    return `<div class="field"><label for="${id}">${f.label}</label>${input}${hint}</div>`;
  }).join('');
  $('#editor-delete').hidden = !item || kind === 'stockPlan';
  $('#editor').showModal();
  $('#editor-fields').querySelectorAll('[data-money]').forEach(previewMoney);
  if (matchMedia('(hover: hover)').matches) $('#editor-fields input')?.focus(); // 모바일은 키보드가 바로 뜨지 않게
}

function previewMoney(input) {
  const out = input.closest('.field').querySelector('.money-preview');
  const n = parseMoney(input.value);
  out.textContent = n ? won(n) : '';
}
const parseMoney = (s) => Math.round(Number(String(s).replace(/[^\d.\-]/g, '')) * 1e4) || 0;

function readForm() {
  const spec = FORMS[editing.kind];
  const out = {};
  for (const f of spec.fields) {
    const el = $(`#f-${f.key}`);
    if (f.type === 'check') out[f.key] = el.checked;
    else if (f.type === 'money') out[f.key] = parseMoney(el.value);
    else if (f.type === 'pct' || f.type === 'number') out[f.key] = el.value === '' ? (f.def ?? 0) : Number(el.value);
    else out[f.key] = el.value.trim();
  }
  return out;
}

function saveForm() {
  const vals = readForm();
  const d = state.data;
  if (editing.kind === 'stockPlan') d.stockPlan = vals;
  else {
    const list = (d[editing.kind] ||= []);
    const i = list.findIndex((x) => x.id === editing.id);
    if (i >= 0) list[i] = { ...list[i], ...vals };
    else list.push({ id: crypto.randomUUID().slice(0, 8), ...vals });
  }
  commit();
}

function deleteItem() {
  const item = state.data[editing.kind].find((x) => x.id === editing.id);
  if (!confirm(`'${item?.name}'을(를) 삭제할까요?`)) return false;
  state.data[editing.kind] = state.data[editing.kind].filter((x) => x.id !== editing.id);
  commit();
  return true;
}

// ───────────────────────── 이벤트 ─────────────────────────
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 3500);
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
      $('#login-error').textContent = /invalid|wrong|not-found|credential/i.test(err.code || '') ? '이메일이나 비밀번호가 맞지 않아요.' : `로그인 실패: ${err.code || err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  $('#view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    const art = b.closest('.item');
    if (a === 'add') openForm(b.dataset.kind);
    if (a === 'edit') openForm(art.dataset.kind, state.data[art.dataset.kind].find((x) => x.id === art.dataset.id));
    if (a === 'plan') openForm('stockPlan', state.data.stockPlan || {});
    if (a === 'cand') {
      const h = state.data.homes.find((x) => x.id === art.dataset.id);
      h.aptName = b.dataset.name;
      commit();
      toast(`단지명을 '${b.dataset.name}'(으)로 바꿨어요. 다음 자동 업데이트 때 반영돼요.`);
    }
    if (a === 'logout') store.logout();
    if (a === 'export') {
      const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `차곡차곡-백업-${new Date().toISOString().slice(0, 10)}.json` });
      link.click();
    }
  });

  $('#view').addEventListener('input', (e) => {
    if (e.target.id === 'horizon') {
      $('#horizon-val').textContent = e.target.value;
      state.data.settings = { ...(state.data.settings || {}), horizon: Number(e.target.value) };
      const { points } = project(state.data, state.market, { years: Number(e.target.value) });
      projectionChart($('#chart-projection'), points);
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
  $('#editor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveForm();
    dlg.close();
  });
  $('#editor-cancel').addEventListener('click', () => dlg.close());
  $('#editor-delete').addEventListener('click', () => deleteItem() && dlg.close());
  $('#editor-fields').addEventListener('input', (e) => {
    if (e.target.matches('[data-money]')) previewMoney(e.target);
    if (e.target.name === 'lawdCd') e.target.closest('.field').querySelector('output').textContent = SIGUNGU.find(([c]) => c === e.target.value)?.[1] || '';
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { redrawAll(); render(); });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(afterRender, 200); });
}

async function main() {
  bind();
  if (isDemo()) document.querySelectorAll('#tabs a').forEach((a) => (a.href = `?demo${a.getAttribute('href')}`));
  store = await connect({
    onAuth: (u) => { state.user = u; render(); },
    onData: (d) => { state.data = { ...EMPTY(), ...(d || {}) }; render(); recordSnapshot(); },
    onMarket: (m) => { state.market = m || {}; render(); recordSnapshot(); },
    onSync: (s) => { state.sync = s; const el = $('#sync'); if (el) { el.textContent = { saving: '저장 중…', saved: '동기화됨', offline: '오프라인 (나중에 동기화)', demo: '체험 모드' }[s] || ''; el.dataset.state = s; } },
  });
  $('#boot').hidden = true;
}

main().catch((e) => {
  $('#boot').textContent = `불러오기에 실패했어요: ${e.message}`;
});

