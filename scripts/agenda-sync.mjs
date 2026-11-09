// GitHub Actions: 앱을 열지 않아도 구글 캘린더·태스크에서 일정·할일을 받아 Firestore(agenda)에 저장해요.
// 1) 앱에서 '자동 동기화 켜기'를 누르면 secrets.googleAuthCode가 저장돼요 → 여기서 오래 쓰는 연결(refresh token)로 바꿔요.
// 2) 연결된 사용자마다 1시간에 한 번 새로 받아요.
// 필요한 GitHub Secret: FIREBASE_SERVICE_ACCOUNT, GOOGLE_CLIENT_SECRET (구글 콘솔의 OAuth 클라이언트 보안 비밀번호)
// 한국 날짜로 계산하도록 워크플로에서 TZ=Asia/Seoul로 실행해요.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { fetchAgenda, keepExternal } from '../js/agenda.js';
import { fetchCalDav } from '../js/caldav.js';
import { listApi } from '../js/google.js';

const SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// 반려자 네이버 캘린더 (선택): 네이버 아이디 + 애플리케이션 비밀번호 (GitHub Secrets)
const NAVER_ID = process.env.NAVER_CALDAV_ID || '';
const NAVER_PW = process.env.NAVER_CALDAV_PASSWORD || '';
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function token(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error_description || j.error || `토큰 오류 ${res.status}`), { code: j.error });
  return j;
}

/** 접근 토큰으로 목록 받기 (여러 쪽이면 모두) */
function serverApi(accessToken) {
  return listApi(async (url) => {
    const items = [];
    let pageToken = '';
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${url}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`구글 오류 ${res.status}: ${j.error?.message || ''}`);
      items.push(...(j.items || []));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    return items;
  });
}

const docs = (await db.collectionGroup('data').get()).docs.filter((d) => d.id === 'secrets');
for (const doc of docs) {
  const sec = doc.data();
  if (!sec.googleAuthCode && !sec.googleRefresh) continue;
  const userRef = doc.ref.parent;
  const gs = (await userRef.doc('main').get()).data()?.settings?.google || {};
  const fail = (msg) => doc.ref.set({ googleLinkError: msg, googleAuthCode: FieldValue.delete() }, { merge: true });
  if (!gs.clientId) { await fail('설정에 구글 클라이언트 ID가 없어요'); continue; }
  if (!SECRET) { await fail('GitHub Secrets에 GOOGLE_CLIENT_SECRET이 없어요. 설정 안내대로 넣은 뒤 다시 켜 주세요'); continue; }

  let refresh = sec.googleRefresh;
  // ① 앱에서 받은 인증 코드 → 오래 쓰는 연결
  if (sec.googleAuthCode) {
    try {
      const j = await token({ code: sec.googleAuthCode, client_id: gs.clientId, client_secret: SECRET, redirect_uri: 'postmessage', grant_type: 'authorization_code' });
      if (!j.refresh_token && !refresh) throw new Error('구글이 오래 쓰는 연결을 주지 않았어요. 구글 계정 → 보안 → 타사 앱 연결에서 차곡차곡을 삭제한 뒤 다시 켜 주세요');
      refresh = j.refresh_token || refresh;
      await doc.ref.set({ googleRefresh: refresh, googleAuthCode: FieldValue.delete(), googleLinkError: FieldValue.delete(), googleLinkedAt: Date.now() }, { merge: true });
      console.log('구글 자동 동기화 연결 완료');
    } catch (e) {
      console.log('연결 실패:', e.message);
      await fail(e.code === 'invalid_client' ? 'GOOGLE_CLIENT_SECRET이 이 클라이언트 ID와 맞지 않아요' : `연결하지 못했어요: ${e.message}`);
      continue;
    }
  }

  // ② 일정·할일 받기
  try {
    const { access_token: at } = await token({ refresh_token: refresh, client_id: gs.clientId, client_secret: SECRET, grant_type: 'refresh_token' });
    let agenda = await fetchAgenda(serverApi(at), gs, new Date());
    if (NAVER_ID && NAVER_PW) {
      try {
        const nv = await fetchCalDav({ base: 'https://caldav.calendar.naver.com/', user: NAVER_ID, pass: NAVER_PW, from: agenda.from, to: agenda.until, gs });
        agenda = { ...agenda, calendars: [...agenda.calendars, ...nv.calendars], events: [...agenda.events, ...nv.events], naver: { at: Date.now(), count: nv.events.length, debug: nv.debug } };
        console.log(`네이버 캘린더 ${nv.calendars.length}개, 일정 ${nv.events.length}개`);
        // 공개 로그라서 캘린더 이름·내용 없이 개수만
        nv.debug.forEach((d, i) => console.log(`  캘린더 ${i + 1}:`, JSON.stringify({ ...d, name: undefined, sample: d.sample ? `(${d.sample.length}자)` : undefined })));
      } catch (e) {
        console.log('네이버 캘린더 실패:', e.message);
        const prev = (await userRef.doc('agenda').get()).data();
        agenda = { ...keepExternal(agenda, prev), naver: { at: Date.now(), error: e.message } }; // 지난번에 받은 것은 남겨요
      }
    }
    await userRef.doc('agenda').set({ ...agenda, by: 'server' });
    await doc.ref.set({ googleSyncedAt: Date.now(), googleLinkError: FieldValue.delete() }, { merge: true });
    console.log(`일정 ${agenda.events.length}개, 할일 ${agenda.tasks.length}개 저장`);
  } catch (e) {
    console.log('동기화 실패:', e.message);
    if (e.code === 'invalid_grant') await doc.ref.set({ googleRefresh: FieldValue.delete(), googleLinkError: '구글 연결이 끊겼어요 (만료·해제). 설정에서 자동 동기화를 다시 켜 주세요' }, { merge: true });
    else await doc.ref.set({ googleLinkError: `마지막 동기화 실패: ${e.message}` }, { merge: true });
  }
}
