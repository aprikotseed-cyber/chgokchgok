// 아침 브리핑 알림 (GitHub Actions가 매일 아침 보내요): 오늘 일정 · 할일 · 오늘 나가는 돈.
// 대출 상환과 고정지출은 '오늘'이 상환일·출금일일 때만 넣어요.
import { upcoming } from './reminders.js?v=20261111m';
import { visibleEvents, eventsOn, groupTasks, dayKey, agendaUntil } from './agenda.js?v=20261111m';

const WEEK = '일월화수목금토';
const list = (items, n = 4) => items.slice(0, n).join(', ') + (items.length > n ? ` 외 ${items.length - n}개` : '');

/** 개수를 숫자 이모지로: 3 → 3️⃣, 10 → 🔟, 12 → 1️⃣2️⃣ */
export const numEmoji = (n) => (n === 10 ? '🔟' : String(n).split('').map((d) => `${d}️⃣`).join(''));

/** 알림 {title, body}. 보낼 게 없으면 null
 *  🗓️ 오늘의 아침 브리핑
 *  └ 일정 2️⃣ : 15:00 학년 협의회, 20:00 야근(반려자)
 *  └ 할일 1️⃣ : 특별중도해지
 *  └ 지난 할일 : 1️⃣개 있어요. 참고!
 *  └ 오늘 출금 : 정수기
 *  (없으면 '└ 일정 ❌', '└ 할일 ❌')
 */
export function morningBriefing(data, agenda, today) {
  const key = dayKey(today);
  const lines = [];
  const linked = !!agenda?.syncedAt;
  if (linked) {
    if (agendaUntil(agenda) >= key) {
      const evs = eventsOn(visibleEvents(agenda, data.settings?.google), key)
        .map((e) => `${e.allDay ? '' : `${e.time} `}${e.title}${e.partner ? '(반려자)' : ''}`);
      lines.push(evs.length ? `└ 일정 ${numEmoji(evs.length)} : ${list(evs)}` : '└ 일정 ❌');
    } else lines.push('└ 일정 : 앱을 한 번 열면 새로 받아와요');
    const g = groupTasks(agenda.tasks || [], key);
    const todo = g.today.map((t) => `${t.time ? `${t.time} ` : ''}${t.title}`);
    lines.push(todo.length ? `└ 할일 ${numEmoji(todo.length)} : ${list(todo)}` : '└ 할일 ❌');
    if (g.overdue.length) lines.push(`└ 지난 할일 : ${numEmoji(g.overdue.length)}개 있어요. 참고!`);
  }
  // 오늘이 출금일·상환일인 것만 (이름만)
  const due = upcoming(data, today, 0).filter((x) => x.dday === 0);
  const out = due.filter((u) => u.type !== 'loan').map((u) => u.name);
  const pay = due.filter((u) => u.type === 'loan').map((u) => u.name);
  if (out.length) lines.push(`└ 오늘 출금 : ${out.join(', ')}`);
  if (pay.length) lines.push(`└ 오늘 상환 : ${pay.join(', ')}`);
  if (!linked && !lines.length) return null; // 일정 연결 전이고 오늘 나갈 돈도 없으면 보내지 않아요
  return { title: '🗓️ 오늘의 아침 브리핑', body: lines.join('\n') };
}
