// GitHub Actions: 5분마다(cron-job.org가 깨워요) 할일·일정 시작 30분 전에 알림을 한 번 보내요.
//  - 할일: 차곡차곡에 저장된 할일 중 날짜·시간이 있는 것
//  - 일정: 구글 캘린더에서 받아 둔 일정 (반려자 캘린더·종일 일정은 빼요). 받아 둔 지 30분이 넘었으면 새로 받아요.
//  - 보낸 것은 push 문서의 reminded에 적어 두어 두 번 보내지 않아요.
// 필요한 GitHub Secret: FIREBASE_SERVICE_ACCOUNT, GOOGLE_CLIENT_SECRET (일정 새로 받기용, 없으면 받아 둔 일정만)
// 공개 기록(로그)에는 제목 없이 개수만 남겨요. 워크플로에서 TZ=Asia/Seoul로 실행해요.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { fetchAgenda, keepExternal, visibleEvents } from '../js/agenda.js';
import { listApi } from '../js/google.js';
import { kstMs, remindersDue, reminderText } from '../js/tasks.js';

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

  // 할일 (날짜·시간이 있고 안 끝낸 것)
  const tasks = (await userRef.collection('tasks').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !t.done && t.due && t.time);
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
  for (const e of visibleEvents(agenda, gs)) {
    if (e.partner || e.allDay || !e.time) continue;
    items.push({ key: `e:${e.calId}:${e.id}:${e.startKey}T${e.time}`, start: kstMs(e.startKey, e.time), title: e.title, time: e.time, kind: 'event' });
  }

  const sent = push.reminded || {};
  const due = remindersDue(items, NOW, sent);
  console.log(`알림 후보 ${items.length}개 중 보낼 것 ${due.length}개`); // 제목은 남기지 않아요
  if (!due.length) continue;

  const n = reminderText(due);
  const res = await messaging.sendEachForMulticast({
    tokens: devices.map((x) => x.token),
    webpush: { notification: { title: n.title, body: n.body, icon: `${APP_URL}icon-192.png`, tag: `chgok-remind-${NOW}`, renotify: true, requireInteraction: true }, fcmOptions: { link: `${APP_URL}#home` } },
  });
  console.log(`보냄 ${res.successCount}, 실패 ${res.failureCount}`);
  // 보낸 것 기록 (이틀 지난 기록은 정리)
  const keep = Object.fromEntries(Object.entries(sent).filter(([, t]) => NOW - t < 2 * 86400_000));
  for (const x of due) keep[x.key] = NOW;
  await dataRef.doc('push').update({ reminded: keep }); // update는 이 칸을 통째로 바꿔요 (정리한 기록이 다시 합쳐지지 않게)
}
