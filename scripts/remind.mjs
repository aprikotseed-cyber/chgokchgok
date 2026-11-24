// GitHub Actions: 5분마다(cron-job.org가 깨워요) 할일·일정 시작 30분 전에 알림을 한 번 보내요.
//  - 할일: 차곡차곡에 저장된 할일 중 날짜·시간이 있는 것
//  - 일정: 구글 캘린더에서 받아 둔 일정 (반려자 캘린더·종일 일정은 빼요). 받아 둔 지 30분이 넘었으면 새로 받아요.
//  - 운동(Exercise 캘린더): 30분 전엔 응원, 끝나고 1시간 뒤엔 운동 일지를 보고 칭찬하거나 살짝 챙겨요.
//  - 보낸 것은 push 문서의 reminded에 적어 두어 두 번 보내지 않아요.
// 필요한 GitHub Secret: FIREBASE_SERVICE_ACCOUNT, GOOGLE_CLIENT_SECRET (일정 새로 받기용, 없으면 받아 둔 일정만)
// 공개 기록(로그)에는 제목 없이 개수만 남겨요. 워크플로에서 TZ=Asia/Seoul로 실행해요.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { fetchAgenda, keepExternal, visibleEvents } from '../js/agenda.js';
import { listApi } from '../js/google.js';
import { kstMs, remindersDue, reminderText } from '../js/tasks.js';
import { weeklyReview, weekOf } from '../js/goals.js';
import { normWorkout, coachingDue, cheerText, afterText, weekCount, isExerciseEvent } from '../js/workouts.js';
import { outflowsBetween } from '../js/assistant.js';

const APP_URL = process.env.APP_URL || 'https://aprikotseed-cyber.github.io/chgokchgok/';
const SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const messaging = getMessaging();
const NOW = Date.now();

async function accessToken(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description || j.error || `토큰 오류 ${res.status}`);
  return j.access_token;
}
const serverApi = (at) => listApi(async (url) => {
  const items = [];
  let page = '';
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${url}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { Authorization: `Bearer ${at}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`구글 오류 ${res.status}`);
    items.push(...(j.items || []));
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return items;
});

const mains = (await db.collectionGroup('data').get()).docs.filter((d) => d.id === 'main');
for (const main of mains) {
  const dataRef = main.ref.parent;          // users/{uid}/data
  const userRef = dataRef.parent;           // users/{uid}
  const gs = main.data()?.settings?.google || {};
  const push = (await dataRef.doc('push').get()).data() || {};
  const devices = push.devices || [];
  if (!devices.length) continue;

  const allTasks = (await userRef.collection('tasks').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  // 할일 (날짜·시간이 있고 안 끝낸 것)
  const tasks = allTasks.filter((t) => !t.done && t.due && t.time);
  const items = tasks.map((t) => ({ key: `t:${t.id}:${t.due}T${t.time}`, start: kstMs(t.due, t.time), title: t.title, time: t.time, kind: 'task' }));

  // 일정 (받아 둔 지 30분이 넘었으면 새로)
  let agenda = (await dataRef.doc('agenda').get()).data() || null;
  const sec = (await dataRef.doc('secrets').get()).data() || {};
  if (sec.googleRefresh && SECRET && gs.clientId && (!agenda?.syncedAt || NOW - agenda.syncedAt > 30 * 60_000)) {
    try {
      const at = await accessToken({ refresh_token: sec.googleRefresh, client_id: gs.clientId, client_secret: SECRET, grant_type: 'refresh_token' });
      const fresh = await fetchAgenda(serverApi(at), gs, new Date(NOW));
      agenda = keepExternal(fresh, agenda);
      await dataRef.doc('agenda').set({ ...agenda, by: 'server' });
    } catch (e) { console.log('일정 새로 받기 실패:', e.message); }
  }
  const data = main.data() || {};
  const coach = data.settings?.workoutCoach !== false;
  for (const e of visibleEvents(agenda, gs)) {
    if (e.partner || e.allDay || !e.time) continue;
    if (coach && isExerciseEvent(e)) continue; // 운동 일정은 아래 운동 코칭으로 따로 (응원 문구)
    items.push({ key: `e:${e.calId}:${e.id}:${e.startKey}T${e.time}`, start: kstMs(e.startKey, e.time), title: e.title, time: e.time, kind: 'event' });
  }

  // 일요일 저녁 8시가 지나면 주간 돌아보기를 한 번 (설정에서 끄지 않았으면)
  const kst = new Date(NOW); // 워크플로가 TZ=Asia/Seoul
  const workouts = (await userRef.collection('workouts').get()).docs.map((d) => normWorkout({ id: d.id, ...d.data() }, kst));
  if (kst.getDay() === 0 && kst.getHours() >= 20 && data.settings?.weekly !== false) {
    const market = (await dataRef.doc('market').get()).data() || {};
    const books = (await userRef.collection('books').get()).docs.map((d) => d.data());
    const weights = Object.fromEntries((await userRef.collection('weights').get()).docs.map((d) => [d.id, d.data()]));
    const r = weeklyReview({ data, agenda, tasks: allTasks, market, today: kst, outflows: (a, b) => outflowsBetween(data, a, b, kst), books, workouts, weights });
    if (push.lastWeekly !== r.week) {
      const wr = await messaging.sendEachForMulticast({
        tokens: devices.map((x) => x.token),
        webpush: { notification: { title: r.title, body: r.body, icon: `${APP_URL}icon-192.png`, tag: `chgok-weekly-${NOW}`, renotify: true }, fcmOptions: { link: `${APP_URL}#home` } },
      });
      console.log(`주간 돌아보기 보냄 ${wr.successCount}, 실패 ${wr.failureCount}`);
      if (wr.successCount) await dataRef.doc('push').set({ lastWeekly: r.week }, { merge: true });
    }
  }

  // 밤 11시가 지나면 일기 알림 한 번 (그날 일기를 아직 안 썼고, 설정에서 끄지 않았으면)
  const dayKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`;
  if (kst.getHours() >= 23 && data.settings?.diaryNudge !== false && push.lastDiaryNudge !== dayKey) {
    const written = (await userRef.collection('diary').doc(dayKey).get()).exists;
    let ok = written; // 이미 썼으면 그날은 더 확인하지 않아요
    if (!written) {
      const dr = await messaging.sendEachForMulticast({
        tokens: devices.map((x) => x.token),
        webpush: { notification: { title: '📔 오늘 하루 어땠어요?', body: '행복했던 일, 인상 깊었던 일, 감사했던 일, 고민거리. 한 줄씩 남겨 볼까요?', icon: `${APP_URL}icon-192.png`, tag: `chgok-diary-${dayKey}`, renotify: true }, fcmOptions: { link: `${APP_URL}#diary-today` } },
      });
      console.log(`일기 알림 보냄 ${dr.successCount}, 실패 ${dr.failureCount}`);
      ok = dr.successCount > 0;
    }
    if (ok) await dataRef.doc('push').set({ lastDiaryNudge: dayKey }, { merge: true });
  }

  const sent = push.reminded || {};
  // 운동 코칭 (설정에서 끄지 않았으면)
  if (coach) {
    const vis = { events: visibleEvents(agenda, gs).filter((e) => !e.partner) };
    const goal = Number((data.goals || []).find((g) => g.kind === 'exercise')?.targetCount) || 0;
    const w = weekOf(kst);
    const coachDue = coachingDue(vis, workouts, NOW, sent, kstMs);
    for (const c of coachDue) {
      const weekDone = weekCount(workouts, w.start, w.end);
      // 응원은 '이번 운동을 하면 몇 번째'로 (오늘 이미 했으면 그대로)
      const next = weekDone + (workouts.some((x) => x.date === c.ev.startKey) ? 0 : 1);
      const n = c.kind === 'cheer' ? cheerText(c.ev, { weekDone: next, goal }) : afterText(c.ev, c.done, { weekDone, goal });
      const r = await messaging.sendEachForMulticast({
        tokens: devices.map((x) => x.token),
        webpush: { notification: { title: n.title, body: n.body, icon: `${APP_URL}icon-192.png`, tag: `chgok-coach-${c.key}`, renotify: true }, fcmOptions: { link: `${APP_URL}#workout` } },
      });
      console.log(`운동 코칭(${c.kind === 'cheer' ? '응원' : '끝난 뒤'}) 보냄 ${r.successCount}, 실패 ${r.failureCount}`);
      if (r.successCount) for (const k of [c.key, ...(c.also || [])]) sent[k] = NOW;
    }
    if (coachDue.length) {
      const keep = Object.fromEntries(Object.entries(sent).filter(([, t]) => NOW - t < 2 * 86400_000));
      await dataRef.doc('push').set({ reminded: keep }, { merge: true });
    }
  }
  const due = remindersDue(items, NOW, sent);
  console.log(`알림 후보 ${items.length}개 중 보낼 것 ${due.length}개`); // 제목은 남기지 않아요
  if (!due.length) continue;

  const n = reminderText(due);
  // 닫을 때까지 남기기(requireInteraction)는 PC에만: 아이폰은 이 옵션이 있으면 안 뜰 때가 있어요 (아침 브리핑과 같아요)
  const mobile = (d) => /iPhone|iPad|Android/.test(d || '');
  const res = await messaging.sendEach(devices.map((d) => ({
    token: d.token,
    webpush: { notification: { title: n.title, body: n.body, icon: `${APP_URL}icon-192.png`, tag: `chgok-remind-${NOW}`, renotify: true, ...(mobile(d.device) ? {} : { requireInteraction: true }) }, fcmOptions: { link: `${APP_URL}#home` } },
  })));
  console.log(`보냄 ${res.successCount}, 실패 ${res.failureCount}`);
  // 보낸 것 기록 (이틀 지난 기록은 정리)
  const keep = Object.fromEntries(Object.entries(sent).filter(([, t]) => NOW - t < 2 * 86400_000));
  for (const x of due) keep[x.key] = NOW;
  await dataRef.doc('push').update({ reminded: keep }); // update는 이 칸을 통째로 바꿔요 (정리한 기록이 다시 합쳐지지 않게)
}
