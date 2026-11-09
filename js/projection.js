import { scheduleBalanceAt, nextScheduled, ymd } from './schedule.js?v=20261110y';
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
/** 종목이 어느 묶음인지: 국내(kr) / 해외(us) / 연금저축(pension). 예전 데이터는 종목코드로 추정 */
export function stockMarket(s) {
  if (s.market) return s.market;
  return /^\d{6}$/.test(String(s.ticker || '').trim()) ? 'kr' : 'us';
}

/**
 * 종목 하나의 평가·수익. 해외주식은 달러 기준 수익과 원화 기준 수익(환율 포함)을 나눠서 계산해요.
 *  - 평가(달러) = 수량 × 현재가($),  평가(원) = 평가(달러) × 지금 환율
 *  - 매입(원)  = 직접 넣은 '원화 매입금액'. 없으면 평균매수가가 원화일 때 수량 × 평균매수가
 *  - 매입 환율 = 매입(원) ÷ 매입(달러)
 *  - 원화 수익 = 평가(원) − 매입(원) = 주가 효과 + 환율 효과
 *      주가 효과 = (평가($) − 매입($)) × 매입 환율
 *      환율 효과 = 평가($) × (지금 환율 − 매입 환율)
 */
export function stockDetail(s, market) {
  const qty = Number(s.qty) || 0;
  const fx = (c) => (c === 'KRW' ? 1 : market?.fx?.[c] || 0);
  const q = market?.stocks?.[normTicker(s.ticker)];
  const avgCur = s.avgCur || 'KRW'; // 예전 데이터의 평균매수가는 원화
  let cur;
  let price;
  if (q?.price) { cur = q.currency || 'KRW'; price = q.price; }
  else if (Number(s.manualPrice)) { cur = s.manualCur || 'KRW'; price = Number(s.manualPrice); }
  else { cur = avgCur; price = Number(s.avgPrice) || 0; }

  const value = price * qty;               // 그 나라 돈으로
  const avg = Number(s.avgPrice) || 0;
  const cost = avgCur === cur ? avg * qty : null;       // 같은 통화로 비교할 수 있을 때만
  const costKrw = Number(s.costKrw) || (avgCur === 'KRW' ? avg * qty : null);
  // 환율을 아직 못 받았으면 0원으로 두지 않고, 매입 환율로 임시 계산해요 (화면에 따로 표시)
  let fxNow = fx(cur);
  let fxEstimated = false;
  if (!fxNow && cur !== 'KRW' && cost && costKrw) { fxNow = costKrw / cost; fxEstimated = true; }
  const valueKrw = value * fxNow;
  const out = { cur, price, value, valueKrw, cost, costKrw, fxNow, fxEstimated };
  if (cost) out.ret = ((value - cost) / cost) * 100;
  if (costKrw) {
    out.profitKrw = valueKrw - costKrw;
    out.retKrw = (out.profitKrw / costKrw) * 100;
  }
  if (cur !== 'KRW' && cost && costKrw) {
    out.buyFx = costKrw / cost;
    out.priceEffect = (value - cost) * out.buyFx;
    out.fxEffect = value * (out.fxNow - out.buyFx);
  }
  return out;
}

export function stockValue(s, market) {
  return stockDetail(s, market).valueKrw;
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

/**
 * 체증식: 매달 원리금이 같은 금액(d)씩 늘어나는 방식.
 * 이번 달 원리금 a와 남은 원금 B, 금리, 남은 기간 n을 알면 만기에 잔액이 0이 되는 d가 하나로 정해집니다.
 *   B = Σ_{k=1..n} (a + (k-1)·d) / (1+i)^k   →   d = (B − a·S0) / S1
 * (한국주택금융공사 예시: 3억·연 4.55%·30년, 첫 회 116만원 → 140회차까지 원리금균등 153만원보다 낮음 — 이 식과 일치)
 */
export function graduatedStep(balance, ratePct, months, firstPayment, elapsed = 0) {
  const i = (Number(ratePct) || 0) / 100 / 12;
  if (!(months > 0) || !(firstPayment > 0)) return null;
  let S0 = 0, S1 = 0;
  for (let k = 1; k <= months; k++) {
    const v = Math.pow(1 + i, -k);
    S0 += v;
    S1 += (k - 1) * v;
  }
  // elapsed: 입력한 원리금이 몇 달 전 기준인지. 그동안 d씩 늘었으니 이번 달 원리금 = firstPayment + elapsed·d
  const denom = elapsed * S0 + S1;
  if (denom === 0) return 0;
  return (balance - firstPayment * S0) / denom;
}

/** 대출에 체증식 정보(_grace, _gradD)를 붙여 둡니다. 시뮬레이션 시작 시 한 번만 계산 */
function prepareLoan(loan, now) {
  const l = { ...loan, _now: now };
  // 거치 후 원리금균등: 실행월 + 거치 기간까지는 이자만, 그 뒤로는 원리금균등
  if (l.method === 'grace_annuity') {
    l.method = 'annuity';
    if (l.startDate) {
      const [y, m] = l.startDate.split('-').map(Number);
      const end = new Date(y, m - 1 + (Number(l.graceYears) || 1) * 12 - 1, 1);
      l.graceEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
    }
  }
  if (l.method === 'graduated') {
    const grace = Math.max(0, monthsFrom(now, l.graceEnd) ?? 0);
    const n = (monthsFrom(now, l.maturity) ?? 0) - grace;
    l._grace = grace;
    const elapsed = Math.max(0, -(monthsFrom(now, l.paymentAsOf) ?? 0)); // 원리금을 입력한 뒤 지난 달 수
    l._gradD = graduatedStep(Number(l.balance) || 0, l.rate, n, Number(l.payment) || 0, elapsed);
    if (l._gradD != null) l._payNow = Number(l.payment) + elapsed * l._gradD;
  }
  return l;
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
  else if (loan.method === 'graduated' && loan._gradD != null) {
    const k = step - (loan._grace || 0);
    const pmt = (loan._payNow ?? Number(loan.payment)) + (k - 1) * loan._gradD;
    principal = remaining === 1 ? balance : pmt - interest;
  }
  else {
    // 원리금균등: 남은 기간으로 매달 다시 계산해도 같은 납입액이 나옵니다.
    const pmt = i === 0 ? balance / remaining : (balance * i) / (1 - Math.pow(1 + i, -remaining));
    principal = pmt - interest;
  }
  return { interest, principal: Math.min(balance, Math.max(0, principal)) };
}

/** 지금 시점의 합계 */
/** 대출의 지금 남은 원금. 상환스케줄이 있으면 스케줄 기준(오늘까지 낸 회차 반영) */
export function loanBalance(loan, now = new Date()) {
  if (loan.schedule?.length) return scheduleBalanceAt(loan.schedule, ymd(now));
  return Number(loan.balance) || 0;
}

export function currentTotals(data, market, now = new Date()) {
  const savings = (data.savings || []).reduce((a, s) => a + (Number(s.balance) || 0), 0);
  const stocks = (data.stocks || []).reduce((a, s) => a + stockValue(s, market), 0);
  const homes = (data.homes || []).reduce((a, h) => a + homeValue(h, market), 0);
  const debts = (data.debts || []).reduce((a, d) => a + loanBalance(d, now), 0);
  const assets = savings + stocks + homes;
  return { savings, stocks, homes, assets, debts, net: assets - debts };
}

/** 대출별 이번 달 예상 원금·이자 */
export function loanThisMonth(loan, now = new Date()) {
  if (loan.schedule?.length) {
    const r = nextScheduled(loan.schedule, ymd(now));
    return r ? { principal: r.principal, interest: r.interest, date: r.date } : { principal: 0, interest: 0 };
  }
  return loanMonth(Number(loan.balance) || 0, prepareLoan(loan, now), 1);
}

/** 대출별 이번 달 예상 납입액 */
export function currentPayment(loan, now = new Date()) {
  const r = loanThisMonth(loan, now);
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
  let stock = currentTotals({ stocks: data.stocks }, market).stocks;
  const homes = (data.homes || []).map((h) => ({ v: homeValue(h, market) })); // 집값 상승률은 가정하지 않아요
  const loans = (data.debts || []).map((d) => ({ d: prepareLoan(d, now), bal: loanBalance(d, now), schedule: d.schedule?.length ? d.schedule : null }));

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
    // 주식은 매수·매도로 직접 관리하니 지금 평가금액 그대로 둬요 (주가 상승률도 가정하지 않아요)
    for (const l of loans) if (!l.schedule) l.bal -= loanMonth(l.bal, l.d, step).principal;
    if ((startMonth + step) % 12 === 11) {
      const year = now.getFullYear() + Math.floor((startMonth + step) / 12);
      // 상환스케줄이 있는 대출은 계산 대신 스케줄의 그해 말 잔액을 그대로 써요
      for (const l of loans) if (l.schedule) l.bal = scheduleBalanceAt(l.schedule, `${year}-12-31`);
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

/** 체증식 대출의 요약: 매달 증가액과 만기 직전 원리금 */
export function graduatedInfo(loan, now = new Date()) {
  const l = prepareLoan(loan, now);
  if (l.method !== 'graduated' || l._gradD == null) return null;
  const n = (monthsFrom(now, l.maturity) ?? 0) - (l._grace || 0);
  return { step: l._gradD, now: l._payNow, last: l._payNow + (n - 1) * l._gradD, months: n };
}
