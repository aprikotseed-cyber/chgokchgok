// 올해 목표와 진행률 · 주간 돌아보기 (화면·서버·테스트가 함께 쓰는 순수 함수)
import { currentTotals } from './projection.js?v=20261124c';
import { scheduleRecords } from './records.js?v=20261124c';

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const num = (v) => Number(v) || 0;
const fmtWon = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;

/** 이 날이 속한 주 (월~일) */
export function weekOf(d) {
  const mon = addDays(d, -((d.getDay() + 6) % 7));
  return { start: key(mon), end: key(addDays(mon, 6)), mon };
}

export const GOAL_KINDS = {
  saving: '올해 저축한 돈',
  debt: '올해 갚은 대출 원금',
  net: '순자산',
  exercise: '이번 주 운동 횟수',
  custom: '직접 세기',
};

/** 기간 안의 저축(입금) 합계 */
export function savedBetween(data, start, end) {
  return (data.records || []).filter((r) => r.type === 'saving' && r.date >= start && r.date <= end).reduce((a, r) => a + num(r.amount), 0);
}
/** 기간 안에 갚은 대출 원금 (직접 넣은 상환 기록 + 상환스케줄의 지난 회차) */
export function repaidBetween(data, start, end, todayKey) {
  const all = [...(data.records || []), ...scheduleRecords(data, todayKey)];
  return all.filter((r) => r.type === 'repayment' && r.date >= start && r.date <= end).reduce((a, r) => a + num(r.amount), 0);
}
/** 기간 안의 운동 일정 수 (Exercise 캘린더, 반려자 일정 빼고) */
export function exerciseBetween(agenda, start, end) {
  return (agenda?.events || []).filter((e) => !e.partner && String(e.calName || '').toLowerCase() === 'exercise' && e.startKey >= start && e.startKey <= end).length;
}

/**
 * 목표 하나의 진행률
 * goal: { id, title, kind, targetWon?, targetCount?, current?, unit? }
 * → { current, target, pct(0~100+), text, sub }
 */
export function goalProgress(goal, { data, market, agenda, today }) {
  const t = key(today);
  const year = today.getFullYear();
  const y0 = `${year}-01-01`;
  const y1 = `${year}-12-31`;
  const dayOfYear = Math.round((today - new Date(year, 0, 1)) / 86400000) + 1;
  const daysInYear = Math.round((new Date(year + 1, 0, 1) - new Date(year, 0, 1)) / 86400000);
  const pace = (cur) => (dayOfYear >= 14 ? cur / dayOfYear * daysInYear : null); // 이 속도면 연말에
  let current = 0;
  let target = 0;
  let text = '';
  let sub = '';
  if (goal.kind === 'saving' || goal.kind === 'debt') {
    current = goal.kind === 'saving' ? savedBetween(data, y0, y1) : repaidBetween(data, y0, y1, t);
    target = num(goal.targetWon);
    text = `${fmtWon(current)} / ${fmtWon(target)}`;
    const p = pace(current);
    if (p != null && target) sub = p >= target ? '이 속도면 연말 전에 달성해요' : `이 속도면 연말에 약 ${fmtWon(p)}`;
  } else if (goal.kind === 'net') {
    current = currentTotals(data, market || {}, today).net;
    target = num(goal.targetWon);
    text = `${fmtWon(current)} / ${fmtWon(target)}`;
    sub = current >= target ? '달성했어요' : `${fmtWon(target - current)} 남았어요`;
  } else if (goal.kind === 'exercise') {
    const w = weekOf(today);
    current = exerciseBetween(agenda, w.start, w.end);
    target = num(goal.targetCount);
    text = `이번 주 ${current}회 / ${target}회`;
    // 지난 4주 평균 (받아 둔 일정 범위 안에서)
    const counts = [1, 2, 3, 4].map((i) => exerciseBetween(agenda, key(addDays(w.mon, -7 * i)), key(addDays(w.mon, -7 * i + 6))));
    if (agenda?.from && agenda.from <= key(addDays(w.mon, -28))) sub = `지난 4주 평균 주 ${(counts.reduce((a, v) => a + v, 0) / 4).toFixed(1)}회`;
  } else {
    current = num(goal.current);
    target = num(goal.targetCount);
    const u = goal.unit || '';
    text = `${current}${u} / ${target}${u}`;
  }
  const pct = target ? Math.max(0, (current / target) * 100) : 0;
  return { current, target, pct, text, sub };
}

/**
 * 주간 돌아보기 (이번 주 월~일 + 다음 주 미리보기)
 * outflows(start, end): 기간 안에 나갈 돈 [{amount}] (고정지출·대출, 부르는 쪽에서 넘겨요)
 */
export function weeklyReview({ data, agenda, tasks, market, today, outflows }) {
  const w = weekOf(today);
  const t = key(today);
  const nextMon = addDays(w.mon, 7);
  const n0 = key(nextMon);
  const n1 = key(addDays(nextMon, 6));
  const lines = [];
  const goals = data.goals || [];
  const exGoal = goals.find((g) => g.kind === 'exercise');
  const ex = exerciseBetween(agenda, w.start, w.end);
  lines.push(`└ 운동 ${ex}회${exGoal ? ` (목표 주 ${num(exGoal.targetCount)}회 ${ex >= num(exGoal.targetCount) ? '달성' : '미달'})` : ''}`);
  const done = (tasks || []).filter((x) => x.done && x.completedAt && x.completedAt >= w.start && x.completedAt <= w.end).length;
  const late = (tasks || []).filter((x) => !x.done && x.due && x.due < t).length;
  lines.push(`└ 할일 ${done}개 끝냄${late ? ` · 밀린 할일 ${late}개` : ''}`);
  const saved = savedBetween(data, w.start, w.end);
  const repaid = repaidBetween(data, w.start, w.end, t);
  if (saved || repaid) lines.push(`└ ${[saved ? `저축 +${fmtWon(saved)}` : '', repaid ? `대출 원금 −${fmtWon(repaid)}` : ''].filter(Boolean).join(' · ')}`);
  const gp = goals.filter((g) => g.kind !== 'exercise').slice(0, 3).map((g) => `${g.title} ${Math.floor(goalProgress(g, { data, market, agenda, today }).pct)}%`);
  if (gp.length) lines.push(`└ 올해 목표: ${gp.join(', ')}`);
  const evs = (agenda?.events || []).filter((e) => !e.partner && e.startKey >= n0 && e.startKey <= n1).length;
  const dueNext = (tasks || []).filter((x) => !x.done && x.due >= n0 && x.due <= n1).length;
  const out = outflows ? outflows(nextMon, addDays(nextMon, 6)).reduce((a, x) => a + num(x.amount), 0) : 0;
  lines.push(`└ 다음 주: 일정 ${evs}개 · 마감 할일 ${dueNext}개${out ? ` · 나갈 돈 ${fmtWon(out)}` : ''}`);
  return { title: '📝 이번 주 돌아보기', body: lines.join('\n'), week: w.start };
}
