// ============================================================
// 나의 재무 비서 — 앱 로직
// Firestore 구조:
//   users/{uid}/categories/{id}      { name }
//   users/{uid}/transactions/{id}    { type, date, merchant, amount, category, account, createdAt }
//   users/{uid}/snapshots/{id}       { bankBalance, cardDebt, investPrincipal, investValue, date, createdAt }
//   users/{uid}/goals/main           { monthlySaving, netWorthTarget, targetYear }
//   users/{uid}/budgets/{categoryName} { monthlyLimit }
// ============================================================

const won = (n) => (n || 0).toLocaleString('ko-KR') + '원';
let uid = null;
let categoryPieChart, netWorthLineChart;

// ---------- 내비게이션 ----------
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
  });
});

auth.onAuthStateChanged((user) => {
  if (!user) return;
  uid = user.uid;
  initApp();
});

function col(name) { return db.collection('users').doc(uid).collection(name); }

async function initApp() {
  await loadCategories();
  await loadTransactions();
  await loadSnapshots();
  await loadGoals();
  await loadBudgets();
  renderAdvisorMemo();
}

// ============================================================
// 카테고리
// ============================================================
let categories = [];

async function loadCategories() {
  const snap = await col('categories').orderBy('name').get();
  categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCategoryList();
  renderCategorySelect();
  renderBudgetCategoryList();
}

function renderCategorySelect() {
  const sel = document.getElementById('txCategory');
  sel.innerHTML = categories.length
    ? categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('')
    : '<option value="">카테고리를 먼저 등록해주세요</option>';
}

function renderCategoryList() {
  const el = document.getElementById('categoryList');
  if (!categories.length) {
    el.innerHTML = '<div class="empty-state">아직 등록된 카테고리가 없어요.</div>';
    return;
  }
  el.innerHTML = categories.map(c => `
    <div class="tx-row">
      <span class="merchant">${c.name}</span>
      <button class="btn btn-danger" style="padding:5px 12px; font-size:12.5px;" onclick="deleteCategory('${c.id}')">삭제</button>
    </div>
  `).join('');
}

document.getElementById('categoryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameEl = document.getElementById('categoryName');
  const name = nameEl.value.trim();
  if (!name) return;
  await col('categories').add({ name, createdAt: Date.now() });
  nameEl.value = '';
  await loadCategories();
});

async function deleteCategory(id) {
  await col('categories').doc(id).delete();
  await loadCategories();
}

// ============================================================
// 내역 (transactions)
// ============================================================
let transactions = [];

document.getElementById('txDate').valueAsDate = new Date();

async function loadTransactions() {
  const snap = await col('transactions').orderBy('date', 'desc').limit(200).get();
  transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderTxList();
  renderDashboardStats();
  renderCategoryPieChart();
}

function renderTxList() {
  const el = document.getElementById('txList');
  const recent = transactions.slice(0, 15);
  if (!recent.length) {
    el.innerHTML = '<div class="empty-state">아직 입력된 내역이 없어요.</div>';
    return;
  }
  el.innerHTML = recent.map(t => `
    <div class="tx-row">
      <div>
        <div class="merchant">${t.merchant}</div>
        <div class="meta">${t.date} · <span class="tag">${t.category || '미분류'}</span> · ${t.account || ''}</div>
      </div>
      <div class="amount ${t.type === 'income' ? 'income' : 'expense'}">
        ${t.type === 'income' ? '+' : '−'}${won(t.amount)}
      </div>
    </div>
  `).join('');
}

document.getElementById('txForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tx = {
    type: document.getElementById('txType').value,
    date: document.getElementById('txDate').value,
    merchant: document.getElementById('txMerchant').value.trim(),
    amount: Number(document.getElementById('txAmount').value),
    category: document.getElementById('txCategory').value,
    account: document.getElementById('txAccount').value,
    createdAt: Date.now(),
  };
  if (!tx.merchant || !tx.amount) return;
  await col('transactions').add(tx);
  document.getElementById('txForm').reset();
  document.getElementById('txDate').valueAsDate = new Date();
  await loadTransactions();
  renderAdvisorMemo();
});

function thisMonthTx(type) {
  const ym = new Date().toISOString().slice(0, 7);
  return transactions.filter(t => t.date && t.date.startsWith(ym) && t.type === type);
}

// ============================================================
// 자산 스냅샷 (통장/카드/투자)
// ============================================================
let snapshots = [];

async function loadSnapshots() {
  const snap = await col('snapshots').orderBy('date', 'asc').get();
  snapshots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderInvestStats();
  renderDashboardStats();
  renderNetWorthLineChart();
}

document.getElementById('investForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entry = {
    bankBalance: Number(document.getElementById('bankBalance').value),
    cardDebt: Number(document.getElementById('cardDebt').value),
    investPrincipal: Number(document.getElementById('investPrincipal').value),
    investValue: Number(document.getElementById('investValue').value),
    date: new Date().toISOString().slice(0, 10),
    createdAt: Date.now(),
  };
  await col('snapshots').add(entry);
  await loadSnapshots();
  renderAdvisorMemo();
});

function latestSnapshot() {
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

function renderInvestStats() {
  const s = latestSnapshot();
  const rateEl = document.getElementById('investReturnRate');
  const amtEl = document.getElementById('investReturnAmount');
  if (!s || !s.investPrincipal) {
    rateEl.textContent = '—';
    amtEl.textContent = '평가손익 —';
    return;
  }
  const profit = s.investValue - s.investPrincipal;
  const rate = (profit / s.investPrincipal) * 100;
  rateEl.textContent = (rate >= 0 ? '+' : '') + rate.toFixed(1) + '%';
  rateEl.parentElement.querySelector('.num-display').style.color = rate >= 0 ? 'var(--sage)' : 'var(--rust-bright)';
  amtEl.textContent = '평가손익 ' + (profit >= 0 ? '+' : '') + won(profit);
  amtEl.className = 'delta ' + (profit >= 0 ? 'up' : 'down');
}

function netWorthOf(s) {
  if (!s) return 0;
  return (s.bankBalance || 0) + (s.investValue || 0) - (s.cardDebt || 0);
}

// ============================================================
// 목표 (goals)
// ============================================================
let goals = { monthlySaving: 0, netWorthTarget: 0, targetYear: null };

async function loadGoals() {
  const doc = await col('goals').doc('main').get();
  if (doc.exists) {
    goals = doc.data();
    document.getElementById('goalMonthlySaving').value = goals.monthlySaving || '';
    document.getElementById('goalNetWorthTarget').value = goals.netWorthTarget || '';
    document.getElementById('goalTargetYear').value = goals.targetYear || '';
  }
}

document.getElementById('goalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  goals = {
    monthlySaving: Number(document.getElementById('goalMonthlySaving').value) || 0,
    netWorthTarget: Number(document.getElementById('goalNetWorthTarget').value) || 0,
    targetYear: Number(document.getElementById('goalTargetYear').value) || null,
  };
  await col('goals').doc('main').set(goals);
  renderDashboardStats();
  renderAdvisorMemo();
});

// ============================================================
// 예산 (budgets, 카테고리별)
// ============================================================
let budgets = {};

async function loadBudgets() {
  const snap = await col('budgets').get();
  budgets = {};
  snap.docs.forEach(d => budgets[d.id] = d.data().monthlyLimit);
  renderBudgetCategoryList();
}

function renderBudgetCategoryList() {
  const el = document.getElementById('budgetCategoryList');
  if (!categories.length) {
    el.innerHTML = '<div class="empty-state">카테고리를 먼저 등록해주세요.</div>';
    return;
  }
  el.innerHTML = categories.map(c => `
    <div class="field" style="display:flex; align-items:center; gap:10px;">
      <label style="min-width:90px; margin:0;">${c.name}</label>
      <input type="number" placeholder="월 예산" value="${budgets[c.name] || ''}"
        onchange="saveBudget('${c.name}', this.value)">
    </div>
  `).join('');
}

async function saveBudget(categoryName, value) {
  budgets[categoryName] = Number(value) || 0;
  await col('budgets').doc(categoryName).set({ monthlyLimit: budgets[categoryName] });
  renderAdvisorMemo();
}

// ============================================================
// 대시보드 통계 + 차트
// ============================================================
function renderDashboardStats() {
  const s = latestSnapshot();
  const nw = netWorthOf(s);
  document.getElementById('statNetWorth').textContent = won(nw);

  const prevSnap = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const nwDeltaEl = document.getElementById('statNetWorthDelta');
  if (prevSnap) {
    const diff = nw - netWorthOf(prevSnap);
    nwDeltaEl.textContent = (diff >= 0 ? '+' : '') + won(diff) + ' (직전 기록 대비)';
    nwDeltaEl.className = 'delta ' + (diff >= 0 ? 'up' : 'down');
  } else {
    nwDeltaEl.textContent = '아직 비교할 이전 기록이 없어요';
  }

  const monthExpense = thisMonthTx('expense').reduce((sum, t) => sum + t.amount, 0);
  const monthIncome = thisMonthTx('income').reduce((sum, t) => sum + t.amount, 0);
  document.getElementById('statMonthExpense').textContent = won(monthExpense);

  const totalBudget = Object.values(budgets).reduce((a, b) => a + b, 0);
  const expenseDeltaEl = document.getElementById('statMonthExpenseDelta');
  if (totalBudget > 0) {
    const pct = Math.round((monthExpense / totalBudget) * 100);
    expenseDeltaEl.textContent = `이번 달 예산의 ${pct}% 사용`;
    expenseDeltaEl.className = 'delta ' + (pct > 100 ? 'down' : 'up');
  } else {
    expenseDeltaEl.textContent = '예산을 설정하면 비교해드려요';
  }

  const monthSaving = monthIncome - monthExpense;
  document.getElementById('statMonthSaving').textContent = won(monthSaving);
  const savingDeltaEl = document.getElementById('statMonthSavingDelta');
  if (goals.monthlySaving) {
    const pct = Math.round((monthSaving / goals.monthlySaving) * 100);
    savingDeltaEl.textContent = `목표(${won(goals.monthlySaving)})의 ${pct}%`;
    savingDeltaEl.className = 'delta ' + (pct >= 100 ? 'up' : 'down');
  } else {
    savingDeltaEl.textContent = '목표 저축액을 설정해보세요';
  }
}

function renderCategoryPieChart() {
  const ym = new Date().toISOString().slice(0, 7);
  const byCategory = {};
  transactions
    .filter(t => t.type === 'expense' && t.date && t.date.startsWith(ym))
    .forEach(t => {
      const cat = t.category || '미분류';
      byCategory[cat] = (byCategory[cat] || 0) + t.amount;
    });

  const labels = Object.keys(byCategory);
  const data = Object.values(byCategory);
  const palette = ['#c9a24a', '#7ea089', '#c1584a', '#8a9bb0', '#e0bd6a', '#5c7a8a', '#a3714f', '#9d7bb0'];

  const ctx = document.getElementById('categoryPieChart');
  if (categoryPieChart) categoryPieChart.destroy();
  categoryPieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['데이터 없음'],
      datasets: [{
        data: data.length ? data : [1],
        backgroundColor: data.length ? palette : ['#26323f'],
        borderColor: '#121a24',
        borderWidth: 2,
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: '#b9c0c9', font: { family: 'Pretendard' }, boxWidth: 12, padding: 14 } }
      },
      cutout: '62%',
    }
  });
}

function renderNetWorthLineChart() {
  const ctx = document.getElementById('netWorthLineChart');
  if (netWorthLineChart) netWorthLineChart.destroy();
  netWorthLineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: snapshots.map(s => s.date),
      datasets: [{
        label: '순자산',
        data: snapshots.map(s => netWorthOf(s)),
        borderColor: '#c9a24a',
        backgroundColor: 'rgba(201,162,74,0.12)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#e0bd6a',
      }]
    },
    options: {
      scales: {
        x: { ticks: { color: '#b9c0c9' }, grid: { color: '#26323f' } },
        y: { ticks: { color: '#b9c0c9', callback: (v) => (v / 10000) + '만' }, grid: { color: '#26323f' } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// ============================================================
// 비서의 한마디 (규칙 기반 코멘트)
// ============================================================
function renderAdvisorMemo() {
  const memoEl = document.getElementById('advisorMemoText');
  const lines = [];

  const monthExpense = thisMonthTx('expense').reduce((sum, t) => sum + t.amount, 0);
  const monthIncome = thisMonthTx('income').reduce((sum, t) => sum + t.amount, 0);
  const monthSaving = monthIncome - monthExpense;

  // 카테고리 초과 체크
  const ym = new Date().toISOString().slice(0, 7);
  const byCategory = {};
  thisMonthTx('expense').forEach(t => {
    const cat = t.category || '미분류';
    byCategory[cat] = (byCategory[cat] || 0) + t.amount;
  });
  const overspent = Object.entries(byCategory).filter(([cat, amt]) => budgets[cat] && amt > budgets[cat]);

  if (overspent.length) {
    const [cat, amt] = overspent[0];
    lines.push(`<span class="tone-warn">"${cat}"</span> 예산을 이번 달 벌써 ${won(amt - budgets[cat])} 초과했어요. 이번 달 남은 기간, 지출을 좀 줄이는 게 좋겠어요.`);
  } else if (goals.monthlySaving && monthSaving < goals.monthlySaving * 0.5 && new Date().getDate() > 15) {
    lines.push(`이번 달 절반이 지났는데 저축 목표의 절반도 못 채웠어요. 이래서 계획한 목표를 이룰 수 있을까요? 이번 주말엔 지출 없이 지내보는 건 어떨까요.`);
  } else if (goals.netWorthTarget) {
    const s = latestSnapshot();
    const nw = netWorthOf(s);
    const remain = goals.netWorthTarget - nw;
    if (remain > 0) {
      lines.push(`목표하신 순자산까지 ${won(remain)} 남았어요. 지금 페이스를 유지하면 분명 도달할 수 있어요, 꾸준히 가봐요.`);
    } else {
      lines.push(`축하해요, 목표 순자산을 이미 달성하셨어요! 다음 목표를 새로 세워보는 건 어때요?`);
    }
  } else if (monthSaving > 0 && monthExpense > 0) {
    lines.push(`이번 달 ${won(monthSaving)}을 저축하셨네요. 나쁘지 않아요. 예산과 목표를 설정하면 더 정확하게 챙겨드릴게요.`);
  } else {
    lines.push(`아직 데이터가 부족해요. 내역을 입력하고 카테고리별 예산, 저축 목표를 설정해두시면 제가 매번 현황을 짚어드릴게요.`);
  }

  memoEl.innerHTML = lines[0];
}
