// GitHub Actions가 매일 오전 8시(한국 시간)에 실행: 아침 브리핑(오늘 일정·할일, 오늘이 상환일·출금일인 돈)을 등록된 기기로 보냅니다.
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

const mains = (await db.collectionGroup('data').get()).docs.filter((d) => d.id === 'main');
for (const doc of mains) {
  // 앱에서 구글 캘린더·태스크를 받아 저장해 둔 일정·할일
  const agenda = (await doc.ref.parent.doc('agenda').get()).data() || null;
  const n = morningBriefing(doc.data(), agenda, today);
  console.log(n ? `브리핑 ${n.body.split('\n').length}줄` : '보낼 내용 없음');
  if (!n) continue;

  const pushRef = doc.ref.parent.doc('push');
  const devices = (await pushRef.get()).data()?.devices || [];
  const tokens = devices.map((x) => x.token);
  if (!tokens.length) { console.log('알림 받을 기기가 등록되지 않았어요'); continue; }

  const res = await messaging.sendEachForMulticast({
    tokens,
    webpush: {
      // requireInteraction: PC(Chrome·Edge)에서는 닫을 때까지 화면에 남아 있어요 (아이폰은 원래 알림센터에 남아요)
      notification: { title: n.title, body: n.body, icon: `${APP_URL}icon-192.png`, tag: `chgok-${today.toISOString().slice(0, 10)}`, requireInteraction: true },
      fcmOptions: { link: `${APP_URL}#home` },
    },
  });
  console.log(`보냄 ${res.successCount}, 실패 ${res.failureCount}`);

  // 앱을 지웠거나 알림을 끈 기기는 목록에서 정리
  const dead = new Set();
  res.responses.forEach((r, i) => {
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || '')) dead.add(tokens[i]);
  });
  if (dead.size) await pushRef.set({ devices: devices.filter((x) => !dead.has(x.token)) }, { merge: true });
}
