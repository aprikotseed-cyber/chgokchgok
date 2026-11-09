// 저축·상환 기록. 기록을 추가/수정/삭제하면 연결된 계좌·대출 잔액도 함께 맞춰 줍니다.
// record: { id, type: 'saving'|'repayment', targetId, date: 'YYYY-MM-DD', amount, interest, kind, memo, applied }
//  - saving:    amount = 저축한 금액 → 저축 잔액 +amount
//  - repayment: amount = 갚은 원금 → 대출 잔액 -amount, interest = 함께 낸 이자(잔액엔 영향 없음)

const listOf = (type) => (type === 'saving' ? 'savings' : 'debts');

/** 기록 하나를 잔액에 반영(sign=1) 또는 되돌리기(sign=-1) */
function applyOne(data, r, sign) {
  if (!r?.applied) return;
  const target = (data[listOf(r.type)] || []).find((x) => x.id === r.targetId);
  if (!target) return;
  const delta = (Number(r.amount) || 0) * sign * (r.type === 'saving' ? 1 : -1);
  target.balance = Math.round((Number(target.balance) || 0) + delta);
}

/** 기록 추가 또는 수정 (data를 직접 바꿉니다) */
export function upsertRecord(data, rec) {
  data.records ||= [];
  const i = data.records.findIndex((x) => x.id === rec.id);
  if (i >= 0) {
    applyOne(data, data.records[i], -1);
    data.records[i] = rec;
  } else data.records.push(rec);
  applyOne(data, rec, 1);
}

export function deleteRecord(data, id) {
  const r = (data.records || []).find((x) => x.id === id);
  if (!r) return;
  applyOne(data, r, -1);
  data.records = data.records.filter((x) => x.id !== id);
}

const blank = () => ({ saving: 0, principal: 0, interest: 0, count: 0 });
function add(acc, r) {
  if (r.type === 'saving') acc.saving += Number(r.amount) || 0;
  else {
    acc.principal += Number(r.amount) || 0;
    acc.interest += Number(r.interest) || 0;
  }
  acc.count++;
}

/** 연도별 합계 (최근 연도 먼저) */
export function yearlySummary(records) {
  const by = {};
  for (const r of records || []) add((by[r.date.slice(0, 4)] ||= blank()), r);
  return Object.entries(by).sort((a, b) => b[0].localeCompare(a[0])).map(([year, v]) => ({ year, ...v }));
}

/** 한 해의 1~12월 합계 */
export function monthlySummary(records, year) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...blank() }));
  for (const r of records || []) if (r.date.startsWith(`${year}-`)) add(months[Number(r.date.slice(5, 7)) - 1], r);
  return months;
}

/** 한 해의 계좌·대출별 합계 */
export function byTarget(records, year) {
  const by = {};
  for (const r of records || []) {
    if (!r.date.startsWith(`${year}-`)) continue;
    add((by[`${r.type}:${r.targetId}`] ||= { type: r.type, targetId: r.targetId, ...blank() }), r);
  }
  return Object.values(by);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 상환스케줄이 있는 대출의 '이미 낸 회차'를 상환 기록처럼 보여주기 (저장하지 않는 자동 기록) */
export function scheduleRecords(data, todayStr) {
  const out = [];
  for (const l of data.debts || []) {
    for (const r of l.schedule || []) {
      if (r.date > todayStr) break;
      out.push({ id: `sch-${l.id}-${r.n}`, type: 'repayment', targetId: l.id, date: r.date, amount: r.principal, interest: r.interest, kind: `${r.n}회차`, auto: true });
    }
  }
  return out;
}
