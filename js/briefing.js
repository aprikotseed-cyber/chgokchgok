// 아침 브리핑 알림 (GitHub Actions가 매일 아침 보내요): 오늘 일정 · 할일 · 오늘 나가는 돈.
// 대출 상환과 고정지출은 '오늘'이 상환일·출금일일 때만 넣어요.
import { upcoming } from './reminders.js?v=20261110z';
import { wonExact } from './format.js?v=20261110z';
import { visibleEvents, eventsOn, groupTasks, dayKey, agendaUntil } from './agenda.js?v=20261110z';

const WEEK = '일월화수목금토';
const list = (items, n = 4) => items.slice(0, n).join(', ') + (items.length > n ? ` 외 ${items.length - n}개` : '');

/** 알림 {title, body}. 보낼 게 없으면 null */
export function morningBriefing(data, agenda, today) {
  const key = dayKey(today);
  const lines = [];
  const linked = !!agenda?.syncedAt;
  if (linked) {
    if (agendaUntil(agenda) >= key) {
      const evs = eventsOn(visibleEvents(agenda, data.settings?.google), key)
        .map((e) => `${e.allDay ? '' : `${e.time} `}${e.title}${e.partner ? '(반려자)' : ''}`);
      lines.push(evs.length ? `일정 ${evs.length}개: ${list(evs)}` : '일정: 오늘은 없어요');
    } else lines.push('일정: 앱을 한 번 열면 새로 받아와요');
    const g = groupTasks(agenda.tasks || [], key);
    const todo = g.today.map((t) => `${t.time ? `${t.time} ` : ''}${t.title}`);
    lines.push(todo.length ? `할일 ${todo.length}개: ${list(todo)}` : '할일: 오늘 마감은 없어요');
    if (g.overdue.length) lines.push(`지난 할일 ${g.overdue.length}개: ${list(g.overdue.map((t) => t.title), 3)}`);
  }
  // 오늘이 상환일·출금일인 것만
  for (const u of upcoming(data, today, 0).filter((x) => x.dday === 0)) {
    lines.push(`${u.type === 'loan' ? '오늘 상환' : '오늘 출금'}: ${u.name} ${u.exact ? '' : '약 '}${wonExact(u.amount)}${u.account ? ` (${u.account})` : ''}`);
  }
  if (!linked && !lines.length) return null; // 일정 연결 전이고 오늘 나갈 돈도 없으면 보내지 않아요
  return { title: `${today.getMonth() + 1}월 ${today.getDate()}일 ${WEEK[today.getDay()]}요일 아침 브리핑`, body: lines.join('\n') };
}
