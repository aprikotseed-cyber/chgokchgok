// 예·적금: 상품 목록과 월별 추이 (화면·테스트 공통 순수 함수)
// deposit: { id, name, type: '적금'|'예금', accountId, amount, start: 'YYYY-MM-DD', maturity: 'YYYY-MM-DD', rate }
//  - 적금: 연결한 저축·현금 계좌의 입금 기록(saving)을 월별로 모아요. 계좌를 연결하지 않았으면 가입한 달부터 매달 amount를 넣은 것으로 봐요(예상).
//  - 예금: 가입한 달에 amount를 맡기고, 다달이 '맡긴 돈 × 연금리 ÷ 12' 이자가 붙는다고 봐요(세전 단리, 예상). 연결 계좌에 더 넣은 돈도 더해요.
// 만기가 지난 달부터는 더하지 않아요. 오늘 이후 달은 비워 둬요.

const num = (v) => Number(v) || 0;
const ym = (d) => String(d || '').slice(0, 7);
const pad = (n) => String(n).padStart(2, '0');
function nextYm(k) { const [y, m] = k.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; }

/** 이 상품의 달별 금액 { 'YYYY-MM': 원 } (오늘이 속한 달까지) */
export function monthlyFlow(dep, records, todayKey) {
  const out = {};
  const add = (k, v) => { if (v) out[k] = (out[k] || 0) + v; };
  const start = ym(dep.start) || ym(todayKey);
  const end = [ym(todayKey), dep.maturity ? ym(dep.maturity) : '9999-12'].sort()[0];
  const linked = (records || []).filter((r) => dep.accountId && r.targetId === dep.accountId && r.type === 'saving' && ym(r.date) >= start && ym(r.date) <= end);
  if (dep.type === '예금') {
    const principal = num(dep.amount);
    add(start, principal);
    for (const r of linked) if (!(ym(r.date) === start && num(r.amount) === principal)) add(ym(r.date), num(r.amount)); // 처음 맡긴 돈이 기록에도 있으면 두 번 세지 않아요
    const interest = Math.round((principal * num(dep.rate)) / 100 / 12);
    for (let k = nextYm(start); k <= end; k = nextYm(k)) add(k, interest);
    return out;
  }
  if (dep.accountId) { for (const r of linked) add(ym(r.date), num(r.amount)); return out; }
  for (let k = start; k <= end; k = nextYm(k)) add(k, num(dep.amount));
  return out;
}

/** 지금까지 쌓인 금액 */
export function depositTotal(dep, records, todayKey) {
  return Object.values(monthlyFlow(dep, records, todayKey)).reduce((a, v) => a + v, 0);
}

/** 한 해의 표: 이전 해까지 합, 1~12월, 총액 */
export function yearTable(deposits, records, year, todayKey) {
  const rows = (deposits || []).map((dep) => {
    const flow = monthlyFlow(dep, records, todayKey);
    const before = Object.entries(flow).filter(([k]) => k < `${year}-01`).reduce((a, [, v]) => a + v, 0);
    const months = Array.from({ length: 12 }, (_, i) => flow[`${year}-${pad(i + 1)}`] || 0);
    const total = Object.entries(flow).filter(([k]) => k <= `${year}-12`).reduce((a, [, v]) => a + v, 0);
    return { id: dep.id, name: dep.name, type: dep.type, before, months, total };
  });
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  return { rows, total: { before: sum((r) => r.before), months: Array.from({ length: 12 }, (_, i) => sum((r) => r.months[i])), total: sum((r) => r.total) } };
}

/** 표에 보여줄 해들: 가장 이른 가입 연도 ~ 올해 */
export function depositYears(deposits, todayKey) {
  const now = Number(todayKey.slice(0, 4));
  const first = Math.min(now, ...(deposits || []).map((d) => Number(String(d.start || '').slice(0, 4)) || now));
  return Array.from({ length: now - first + 1 }, (_, i) => first + i);
}
