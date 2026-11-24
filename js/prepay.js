// 중도상환 계산: 원금 일부를 먼저 갚으면 월상환액·이자·기간이 어떻게 바뀌는지, 중도상환수수료는 얼마인지.
// 금리가 그대로라고 보고 계산한 예상치예요.
import { loanRows, monthsFrom } from './projection.js?v=20261124j';

/**
 * 중도상환수수료: 갚는 금액 × 수수료율 × (면제될 때까지 남은 달 ÷ 수수료 기간)
 *  - loan.prepayFee: 수수료율(%). 비워 두면 null(모름), 0이면 수수료 없음
 *  - loan.feeEnd: 수수료가 없어지는 달(YYYY-MM). 지났으면 0원
 *  - loan.feeSlide: 남은 기간만큼 줄어드는지(기본 켜짐), loan.feeYears: 수수료 기간(기본 3년)
 */
export function prepayFee(loan, amount, now = new Date()) {
  if (loan.prepayFee === '' || loan.prepayFee == null) return { known: false, fee: 0 };
  const rate = Number(loan.prepayFee) || 0;
  if (!rate) return { known: true, fee: 0, rate: 0 };
  const left = monthsFrom(now, loan.feeEnd);
  if (left != null && left <= 0) return { known: true, fee: 0, rate, ended: true };
  const span = (Number(loan.feeYears) || 3) * 12;
  const ratio = loan.feeSlide === false || left == null ? 1 : Math.min(1, left / span);
  return { known: true, fee: Math.round(amount * (rate / 100) * ratio), rate, ratio, feeEnd: loan.feeEnd || '' };
}

/**
 * 원금 amount를 먼저 갚으면
 *  - 월상환액을 줄이는 방식(만기 그대로): 앞으로 낼 금액이 모두 남은 원금 비율만큼 줄어요 (금리·만기가 같으면 정확히 비례)
 *  - 기간을 줄이는 방식(월상환액 그대로): 같은 금액을 계속 내면 몇 달 일찍 끝나는지
 */
export function simulatePrepay(loan, amount, now = new Date()) {
  const { balance, term, rows } = loanRows(loan, now);
  const pay = Math.min(Math.max(0, Number(amount) || 0), balance);
  const fee = prepayFee(loan, pay, now);
  const out = { name: loan.name, balance, amount: pay, all: pay >= balance - 0.5, fee, term, months: rows.length };
  if (!balance || !rows.length) return { ...out, empty: true };
  const r = (balance - pay) / balance;
  const interest = rows.reduce((a, x) => a + x.interest, 0);
  const next = rows[0];
  out.next = { date: next.date || '', before: next.payment, after: next.payment * r };
  out.after = balance - pay;
  if (!term) { out.monthlyInterestSaved = next.interest * (1 - r); return out; }
  out.interestBefore = interest;
  out.lower = { saved: interest * (1 - r) }; // 월상환액 줄이기
  if (out.all) return out;
  // 기간 줄이기: 월 금리는 계산식이 있으면 그것, 스케줄이면 첫 회차 이자 ÷ 남은 원금
  const i = loan.schedule?.length ? next.interest / balance : (Number(loan.rate) || 0) / 100 / 12;
  let b = balance - pay;
  let paid = 0;
  let n = 0;
  for (const x of rows) {
    if (b <= 0.5) break;
    const it = b * i;
    paid += it;
    b -= Math.max(0, x.payment - it);
    n++;
  }
  if (b <= 0.5 && n < rows.length) out.shorter = { months: rows.length - n, saved: Math.max(0, interest - paid) };
  return out;
}
