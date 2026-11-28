// 할일: 차곡차곡에 직접 저장해요 (users/{uid}/tasks/{id}). 여러 기기에서 함께 보여요.
// 구글 태스크는 앱에서 시간·반복을 넣을 수 없어서, 할일은 차곡차곡이 직접 관리하고 일정만 구글 캘린더와 연동해요.
// task: { id, title, notes, due: 'YYYY-MM-DD'|'', time: 'HH:MM'|'', repeat: 규칙|null, series, done, completedAt, createdAt, updatedAt }
import { nextFrom, firstOccurrence } from './agenda.js?v=20261128b';

const rid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 새 할일 한 개 */
export function makeTask({ title, due = '', time = '', repeat = null, notes = '', series = '', routine }, nowMs = Date.now()) {
  const id = rid();
  // 반복 할일은 첫 날을 규칙에 맞는 날로 (토요일에 '평일마다'를 만들면 돌아오는 월요일부터)
  if (repeat && due) due = firstOccurrence(repeat, due);
  return { id, title: String(title || '').trim(), notes: notes || '', due: due || '', time: time || '', repeat: repeat || null, series: repeat ? series || id : '', ...(routine != null ? { routine: !!routine } : {}), done: false, completedAt: '', createdAt: nowMs, updatedAt: nowMs };
}

/** 루틴인지: 직접 정했으면 그대로, 아니면 반복 할일은 루틴으로 봐요 */
export const isRoutine = (t) => (t.routine != null ? !!t.routine : !!t.repeat);

/**
 * 오늘의 루틴: 아직 안 한 루틴(날짜가 지났어도 '지남' 없이 오늘 것으로) + 오늘 끝낸 루틴.
 * 같은 반복에서 안 한 게 여러 개면 가장 최근 것 하나만.
 */
export function routinesToday(tasks, todayKey) {
  const list = (tasks || []).filter((t) => isRoutine(t) && t.due && (t.done ? t.completedAt === todayKey : t.due <= todayKey));
  const bySeries = new Map();
  for (const t of list) {
    const k = t.done ? `done:${t.id}` : `open:${t.series || t.id}`;
    const prev = bySeries.get(k);
    if (!prev || t.due > prev.due) bySeries.set(k, t);
  }
  return [...bySeries.values()].sort((a, b) => (a.done - b.done) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
}

/** 저장된 모양 → 화면용 (빠진 칸 채우기) */
export function normLocalTask(t) {
  return { notes: '', due: '', time: '', repeat: null, series: '', done: false, completedAt: '', ...t, title: t.title || '(제목 없음)' };
}

/**
 * 반복 할일을 끝냈을 때 만들 다음 차례 (없으면 null)
 *  - 같은 반복(series)의 안 끝낸 할일이 오늘 이후로 이미 있으면 만들지 않아요 (중복 방지)
 *  - 늦게 끝내도 같은 반복 중 가장 늦은 날짜 다음부터, 오늘보다 앞선 날짜는 만들지 않아요
 */
export function nextRepeatTask(t, all, todayKey, nowMs = Date.now()) {
  if (!t.repeat) return null;
  const series = t.series || t.id;
  const same = (all || []).filter((x) => x.id !== t.id && (x.series || x.id) === series && x.due);
  if (same.some((x) => !x.done && x.due >= todayKey)) return null;
  const last = [t.due || todayKey, ...same.map((x) => x.due)].sort().at(-1);
  const next = nextFrom(t.repeat, last, todayKey);
  if (!next) return null;
  return { ...makeTask({ title: t.title, due: next, time: t.time, repeat: t.repeat, notes: t.notes, series, routine: t.routine }, nowMs) };
}

/** 'YYYY-MM-DD' + 'HH:MM' (한국 시간) → 시각(ms) */
export function kstMs(dateKey, hm) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h - 9, mi);
}

/**
 * 30분 전 알림을 보낼 것들: 시작까지 0~30분 남았고 아직 안 보낸 것
 * items: [{key, start(ms), title, kind: 'task'|'event'}], sent: {key: ms}
 */
export function remindersDue(items, nowMs, sent = {}, before = 30 * 60_000) {
  return items.filter((x) => x.start > nowMs && x.start - nowMs <= before && !sent[x.key]).sort((a, b) => a.start - b.start);
}

/** 알림 문구: 비서가 알려 드리는 말투 */
export function reminderText(list) {
  const one = (x) => `${x.time} ${x.title}${x.kind === 'task' ? ' (할일)' : ''}`;
  if (list.length === 1) {
    const x = list[0];
    return x.kind === 'task'
      ? { title: '⏰ 30분 뒤 할일', body: `덕준님, ${x.time}에 할 일 ‘${x.title}’이 있어요.` }
      : { title: '⏰ 30분 뒤 일정', body: `덕준님, ${x.time}에 ‘${x.title}’ 일정이 있어요.` };
  }
  return { title: `⏰ 30분 안에 ${list.length}개`, body: list.map(one).join('\n') };
}
