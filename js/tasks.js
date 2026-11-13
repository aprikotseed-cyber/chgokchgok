// 할일: 차곡차곡에 직접 저장해요 (users/{uid}/tasks/{id}). 여러 기기에서 함께 보여요.
// 구글 태스크는 앱에서 시간·반복을 넣을 수 없어서, 할일은 차곡차곡이 직접 관리하고 일정만 구글 캘린더와 연동해요.
// task: { id, title, notes, due: 'YYYY-MM-DD'|'', time: 'HH:MM'|'', repeat: 규칙|null, series, done, completedAt, createdAt, updatedAt }
import { nextFrom } from './agenda.js?v=20261113e';

const rid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 새 할일 한 개 */
export function makeTask({ title, due = '', time = '', repeat = null, notes = '', series = '' }, nowMs = Date.now()) {
  const id = rid();
  return { id, title: String(title || '').trim(), notes: notes || '', due: due || '', time: time || '', repeat: repeat || null, series: repeat ? series || id : '', done: false, completedAt: '', createdAt: nowMs, updatedAt: nowMs };
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
  return { ...makeTask({ title: t.title, due: next, time: t.time, repeat: t.repeat, notes: t.notes, series }, nowMs) };
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
