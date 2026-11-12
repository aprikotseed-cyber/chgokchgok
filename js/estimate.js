// 지난 달들의 총자산 추정. 매일 기록이 쌓이기 전 달을, 입력해 둔 기록으로 거꾸로 계산해요.
//  - 저축: 지금 잔액에서 그 달 말 이후의 저축은 빼고, 출금은 다시 더해요
//  - 주식: 주가는 빼고 그 달 말까지 넣어 둔 원금(원화 매입금액)으로만 (매매 기록으로 되돌려요)
//  - 주택: 그 달의 실거래 중앙값 (없으면 그 전 달, 자동 시세를 안 쓰면 직접 넣은 값)
//  - 대출: 상환스케줄이 있으면 그 날짜의 잔액, 없으면 지금 잔액 + 그 뒤에 갚은 원금
// 기록·매매가 처음 있는 달부터 지난달까지 만들어요. 결과에는 est: true가 붙어요.
import { scheduleBalanceAt } from './schedule.js?v=20261112i';

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => Number(v) || 0;

/** 'YYYY-MM' → 그 달 마지막 날 'YYYY-MM-DD' */
function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
}

/** 지금 들고 있는 종목의 원화 원금 */
function costNow(s, market) {
  if (num(s.costKrw)) return num(s.costKrw);
  const base = num(s.qty) * num(s.avgPrice);
  const cur = s.avgCur || 'KRW';
  return cur === 'KRW' ? base : base * num(market?.fx?.[cur]);
}

/** 그날 끝에 들고 있던 원금: 그 뒤 첫 거래의 '거래 전 상태'로 되돌려요 */
export function stockCostAt(s, end, market) {
  const later = (s.trades || []).filter((t) => t.date > end).sort((a, b) => a.date.localeCompare(b.date));
  if (!later.length) return costNow(s, market);
  const b = later[0].before || {};
  if (!num(b.qty)) return 0;
  return costNow({ ...s, ...b }, market);
}

function homeAt(h, ym, market) {
  const share = (h.share ?? 100) / 100;
  const mh = market?.homes?.[h.id];
  if (h.useAuto !== false && mh?.monthly?.length) {
    const m = mh.monthly.filter((x) => x.ym <= ym).at(-1);
    if (m) return m.median * share;
    return (mh.estimate || 0) * share;
  }
  return num(h.manualPrice) * share;
}

function debtAt(l, end, records) {
  if (l.schedule?.length) return scheduleBalanceAt(l.schedule, end);
  const repaidAfter = records.filter((r) => r.type === 'repayment' && r.targetId === l.id && r.date > end).reduce((a, r) => a + num(r.amount), 0);
  return num(l.balance) + repaidAfter;
}

/** 'YYYY-MM' 하나의 그 달 말 추정 */
export function estimateAt(data, market, ym) {
  const end = monthEnd(ym);
  const records = data.records || [];
  let cash = 0;
  for (const s of data.savings || []) {
    let bal = num(s.balance);
    for (const r of records) {
      if (r.targetId !== s.id || r.date <= end) continue;
      if (r.type === 'saving') bal -= num(r.amount);
      else if (r.type === 'withdraw') bal += num(r.amount);
    }
    cash += Math.max(0, bal);
  }
  const stocks = (data.stocks || []).reduce((a, s) => a + stockCostAt(s, end, market), 0);
  const homes = (data.homes || []).reduce((a, h) => a + homeAt(h, ym, market), 0);
  const debts = (data.debts || []).reduce((a, l) => a + debtAt(l, end, records), 0);
  const r = Math.round;
  return { net: r(cash + stocks + homes - debts), savings: r(cash + stocks), stocks: r(stocks), homes: r(homes), debts: r(debts), est: true };
}

/** 기록이 처음 있는 달부터 지난달까지 {'YYYY-MM': 추정} (최대 10년) */
export function estimateMonths(data = {}, market = {}, today = new Date()) {
  const dates = [
    ...(data.records || []).map((r) => r.date),
    ...(data.stocks || []).flatMap((s) => (s.trades || []).map((t) => t.date)),
  ].filter((d) => /^\d{4}-\d{2}/.test(d || '')).sort();
  if (!dates.length) return {};
  const out = {};
  const thisYm = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  let [y, m] = dates[0].slice(0, 7).split('-').map(Number);
  const floor = today.getFullYear() - 10;
  if (y < floor) { y = floor; m = 1; }
  for (;;) {
    const ym = `${y}-${pad(m)}`;
    if (ym >= thisYm) break;
    out[ym] = estimateAt(data, market, ym);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
