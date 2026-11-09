// 자산·부채 계산과 연도별 예측. 화면(app.js)과 테스트가 함께 쓰는 순수 함수만 둡니다.
// 금액 단위는 모두 '원'입니다.

/** 'YYYY-MM' 문자열 → 기준일로부터 몇 달 뒤인지 (기준일이 속한 달 = 0) */
export function monthsFrom(now, ym) {
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return null;
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
}

/** 주식 한 종목의 원화 평가금액 */
export function stockValue(s, market) {
  const q = market?.stocks?.[normTicker(s.ticker)];
  let price = q?.price ?? (Number(s.manualPrice) || Number(s.avgPrice) || 0);
  if (q?.currency && q.currency !== 'KRW') price *= market?.fx?.[q.currency] ?? 0;
  return price * (Number(s.qty) || 0);
}

export function normTicker(t) {
  return String(t || '').trim().toUpperCase();
}

/** 집 한 채의 현재 가치(내 지분만큼) */
export function homeValue(h, market) {
  const auto = market?.homes?.[h.id]?.estimate;
  const base = h.useAuto !== false && auto ? auto : Number(h.manualPrice) || 0;
  return base * ((h.share ?? 100) / 100);
}

/** 이번 달 대출 1건의 상환 (이자, 원금). step은 지금으로부터 몇 번째 달인지(1부터) */
export function loanMonth(balance, loan, step) {
  if (balance <= 0) return { interest: 0, principal: 0 };
  const i = (Number(loan.rate) || 0) / 100 / 12;
  const interest = balance * i;
  const toMaturity = monthsFrom(loan._now, loan.maturity);
  const remaining = toMaturity == null ? Infinity : toMaturity - step + 1;
  if (remaining <= 0) return { interest, principal: balance };

  const graceEnd = monthsFrom(loan._now, loan.graceEnd);
  if (graceEnd != null && step <= graceEnd) return { interest, principal: 0 };

  let principal = 0;
  if (remaining === Infinity) principal = 0;
  else if (loan.method === 'bullet') principal = remaining === 1 ? balance : 0;
  else if (loan.method === 'equal') principal = balance / remaining;
  else {
    // 원리금균등: 남은 기간으로 매달 다시 계산해도 같은 납입액이 나옵니다.
    const pmt = i === 0 ? balance / remaining : (balance * i) / (1 - Math.pow(1 + i, -remaining));
    principal = pmt - interest;
  }
  return { interest, principal: Math.min(balance, Math.max(0, principal)) };
}

/** 지금 시점의 합계 */
export function currentTotals(data, market) {
  const savings = (data.savings || []).reduce((a, s) => a + (Number(s.balance) || 0), 0);
  const stocks = (data.stocks || []).reduce((a, s) => a + stockValue(s, market), 0);
  const homes = (data.homes || []).reduce((a, h) => a + homeValue(h, market), 0);
  const debts = (data.debts || []).reduce((a, d) => a + (Number(d.balance) || 0), 0);
  const assets = savings + stocks + homes;
  return { savings, stocks, homes, assets, debts, net: assets - debts };
}

/** 대출별 이번 달 예상 납입액 */
export function currentPayment(loan, now = new Date()) {
  const r = loanMonth(Number(loan.balance) || 0, { ...loan, _now: now }, 1);
  return r.interest + r.principal;
}

/**
 * 월 단위로 시뮬레이션해서 '지금'과 매년 12월 말 값을 기록합니다.
 * @returns {{points: Array<{label, year, savings, stocks, homes, assets, debts, net, byLoan}>}}
 */
export function project(data, market, { years = 15, now = new Date() } = {}) {
  const savings = (data.savings || []).map((s) => ({
    bal: Number(s.balance) || 0,
    monthly: Number(s.monthly) || 0,
    r: (Number(s.rate) || 0) / 100 / 12,
  }));
  const plan = data.stockPlan || {};
  let stock = currentTotals({ stocks: data.stocks }, market).stocks;
  const stockMonthly = Number(plan.monthly) || 0;
  const stockR = Math.pow(1 + (Number(plan.rate) || 0) / 100, 1 / 12);
  const homes = (data.homes || []).map((h) => ({
    v: homeValue(h, market),
    g: Math.pow(1 + (Number(h.growth) || 0) / 100, 1 / 12),
  }));
  const loans = (data.debts || []).map((d) => ({ d: { ...d, _now: now }, bal: Number(d.balance) || 0 }));

  const snap = (label, year) => {
    const s = savings.reduce((a, x) => a + x.bal, 0);
    const h = homes.reduce((a, x) => a + x.v, 0);
    const debts = loans.reduce((a, x) => a + x.bal, 0);
    const assets = s + stock + h;
    return {
      label, year, savings: s, stocks: stock, homes: h, assets, debts, net: assets - debts,
      byLoan: loans.map((x) => x.bal),
    };
  };

  const points = [snap('현재', now.getFullYear())];
  const startMonth = now.getMonth();
  let step = 0;
  let recorded = 0;
  while (recorded < years) {
    step++;
    for (const s of savings) s.bal = s.bal * (1 + s.r) + s.monthly;
    stock = stock * stockR + stockMonthly;
    for (const h of homes) h.v *= h.g;
    for (const l of loans) l.bal -= loanMonth(l.bal, l.d, step).principal;
    if ((startMonth + step) % 12 === 11) {
      const year = now.getFullYear() + Math.floor((startMonth + step) / 12);
      points.push(snap(`${year}`, year));
      recorded++;
    }
  }
  return { points };
}

/** 그래프 아래 한 줄 요약에 쓰는 이정표 */
export function milestones(points) {
  const out = {};
  const startDebt = points[0]?.debts ?? 0;
  if (startDebt > 0) {
    const free = points.find((p, i) => i > 0 && p.debts < 1);
    out.debtFreeYear = free ? free.year : null;
  }
  const net0 = points[0]?.net ?? 0;
  const steps = [1e8, 3e8, 5e8, 1e9, 2e9, 3e9, 5e9, 1e10];
  const next = steps.find((s) => s > net0);
  if (next) {
    const hit = points.find((p) => p.net >= next);
    out.nextNet = { target: next, year: hit ? hit.year : null };
  }
  return out;
}
