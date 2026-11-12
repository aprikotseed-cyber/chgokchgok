// GitHub Actions가 매일 오전 7시 30분(한국 시간)에 실행 (cron-job.org가 깨우고, GitHub 예약은 예비): 아침 브리핑(오늘 일정·할일, 오늘이 상환일·출금일인 돈)을 등록된 기기로 보냅니다.
// 필요한 GitHub Secret: FIREBASE_SERVICE_ACCOUNT
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { morningBriefing } from '../js/briefing.js';

const APP_URL = process.env.APP_URL || 'https://aprikotseed-cyber.github.io/chgokchgok/';

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const messaging = getMessaging();

// GitHub 서버는 UTC라서 한국 날짜로 바꿔서 계산
const k = new Date(Date.now() + 9 * 3600_000);
const today = new Date(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
console.log(`기준일(한국): ${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`);
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
// GitHub 예약 실행은 몇 시간씩 늦을 때가 있어요. 예약으로 늦게(10시 30분 넘어) 돌았으면 '아침' 브리핑은 보내지 않아요.
// 외부 알람(cron-job.org)·직접 실행(workflow_dispatch)은 시각과 관계없이 보내요.
const late = process.env.GITHUB_EVENT_NAME === 'schedule' && k.getUTCHours() * 60 + k.getUTCMinutes() > 10 * 60 + 30;
if (late) console.log('예약 실행이 늦게 돌아서 아침 브리핑은 건너뛰어요');

const mains = (await db.collectionGroup('data').get()).docs.filter((d) => d.id === 'main');

// 설정의 '알림 시험 보내기': 브리핑 대신 짧은 시험 알림을 모든 기기에 (오늘 브리핑 기록에는 영향 없어요)
if (process.env.TEST === 'true') {
  const hm = `${k.getUTCHours()}시 ${String(k.getUTCMinutes()).padStart(2, '0')}분`;
  for (const doc of mains) {
    const devices = (await doc.ref.parent.doc('push').get()).data()?.devices || [];
    if (!devices.length) continue;
    const r = await messaging.sendEachForMulticast({
      tokens: devices.map((x) => x.token),
      // 제목 없이 보내 보기 (아이폰은 웹앱 알림에 'from 차곡차곡' 줄을 늘 붙여서, 제목을 빼면 더 깔끔한지 시험)
      webpush: { notification: { title: '', body: `알림 시험 (${hm}): 이 알림이 보이면 아침 브리핑도 받을 수 있어요.`, icon: `${APP_URL}icon-192.png`, tag: `chgok-test-${Date.now()}`, renotify: true }, fcmOptions: { link: `${APP_URL}#settings` } },
    });
    console.log(`시험 알림: 보냄 ${r.successCount}, 실패 ${r.failureCount}`, r.responses.map((x) => x.error?.code).filter(Boolean));
  }
  process.exit(0);
}
for (const doc of mains) {
  if (late) break;
  const pushRef = doc.ref.parent.doc('push');
  // 하루에 한 번만 (외부 알람과 GitHub 예약이 둘 다 돌아도)
  if ((await pushRef.get()).data()?.lastBriefing === todayKey) { console.log('오늘 브리핑은 이미 보냈어요'); continue; }
  // 앱에서 구글 캘린더를 받아 저장해 둔 일정
  const agenda = (await doc.ref.parent.doc('agenda').get()).data() || null;
  // 할일은 차곡차곡에 직접 저장된 것 (users/{uid}/tasks)
  const tasks = (await doc.ref.parent.parent.collection('tasks').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const n = morningBriefing(doc.data(), agenda, today, tasks);
  console.log(n ? `브리핑 ${n.body.split('\n').length}줄` : '보낼 내용 없음');
  if (!n) continue;

  const devices = (await pushRef.get()).data()?.devices || [];
  const tokens = devices.map((x) => x.token);
  if (!tokens.length) { console.log('알림 받을 기기가 등록되지 않았어요'); continue; }

  const res = await messaging.sendEachForMulticast({
    tokens,
    webpush: {
      // requireInteraction: PC(Chrome·Edge)에서는 닫을 때까지 화면에 남아 있어요 (아이폰은 원래 알림센터에 남아요)
      notification: { title: n.title, body: n.body, icon: `${APP_URL}icon-192.png`, tag: `chgok-brief-${Date.now()}`, renotify: true, requireInteraction: true },
      fcmOptions: { link: `${APP_URL}#home` },
    },
  });
  console.log(`보냄 ${res.successCount}, 실패 ${res.failureCount}`);
  if (res.successCount) await pushRef.set({ lastBriefing: todayKey }, { merge: true });

  // 앱을 지웠거나 알림을 끈 기기는 목록에서 정리
  const dead = new Set();
  res.responses.forEach((r, i) => {
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || '')) dead.add(tokens[i]);
  });
  if (dead.size) await pushRef.set({ devices: devices.filter((x) => !dead.has(x.token)) }, { merge: true });
}
