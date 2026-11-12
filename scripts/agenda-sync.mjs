// GitHub Actions: 앱을 열지 않아도 구글 캘린더·태스크에서 일정·할일을 받아 Firestore(agenda)에 저장해요.
// 1) 앱에서 '자동 동기화 켜기'를 누르면 secrets.googleAuthCode가 저장돼요 → 여기서 오래 쓰는 연결(refresh token)로 바꿔요.
// 2) 단축어가 보낸 일정·할일·메모(users/{uid}/inbox, 본인만 읽는 곳)를 구글·메모에 넣고 알림을 보내요.
// 3) 연결된 사용자마다 1시간에 한 번 새로 받아요.
// 필요한 GitHub Secret: FIREBASE_SERVICE_ACCOUNT, GOOGLE_CLIENT_SECRET (구글 콘솔의 OAuth 클라이언트 보안 비밀번호)
// 한국 날짜로 계산하도록 워크플로에서 TZ=Asia/Seoul로 실행해요.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { fetchAgenda, keepExternal, parseEventInput, parseQuickTask, toGoogleEvent, toTaskDue, eventLine, repeatLabel, dueLabel, dayKey, inboxKind } from '../js/agenda.js';
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

// ───── 단축어 받은편지함 ─────
const APP_URL = process.env.APP_URL || 'https://aprikotseed-cyber.github.io/chgokchgok/';

async function notify(userRef, title, body) {
  const devices = (await userRef.collection('data').doc('push').get()).data()?.devices || [];
  if (!devices.length) return;
  await getMessaging().sendEachForMulticast({
    tokens: devices.map((x) => x.token),
    webpush: { notification: { title, body, icon: `${APP_URL}icon-192.png`, tag: `chgok-inbox-${Date.now()}`, renotify: true }, fcmOptions: { link: `${APP_URL}#home` } },
  }).catch((e) => console.log('알림 실패:', e.message));
}

async function googleFetch(at, url, body) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`구글 오류 ${res.status}: ${j.error?.message || ''}`);
  return j;
}

/** 받은편지함 하나 처리 → 알림에 쓸 한 줄 */
async function handleInbox(userRef, item, ctx) {
  let kind = inboxKind(item.kind);
  const text = String(item.text || '').trim();
  if (!text) return null;
  if (kind === 'mixed') {
    // 무엇을 골랐는지 알 수 없으니 내용은 메모로 지키고, 단축어 설정을 알려줘요
    ctx.warn = '단축어 6단계의 kind 칸에 목록 전체가 들어가 있어요. ‘목록에서 선택’의 결과(선택한 항목)로 바꿔 주세요. 이번 내용은 메모에 넣었어요.';
    kind = 'memo';
  }
  if (kind === 'memo') {
    const t = Date.now();
    await userRef.collection('memos').doc(`m${t.toString(36)}${Math.random().toString(36).slice(2, 5)}`).set({ text, pinned: false, createdAt: item.at || t, updatedAt: t, source: 'shortcut' });
    return `메모: ${text.split('\n')[0]}`;
  }
  const at = await ctx.accessToken();
  if (kind === 'event') {
    const cals = (await ctx.api().calendars(false)).filter((c) => ['owner', 'writer'].includes(c.accessRole)).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || '' }));
    const p = parseEventInput(text, new Date(), cals, ctx.gs.keywords || []);
    if (!p.title) throw new Error('일정 내용을 알아듣지 못했어요');
    const ev = { ...p, date: p.date || dayKey(new Date()) };
    const cal = cals.find((c) => c.name === p.calName) || cals.find((c) => c.name.toLowerCase() === 'life') || cals[0];
    await googleFetch(at, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`, toGoogleEvent(ev));
    return `${cal.name}: ${eventLine(ev)}${ev.repeat ? ` (${repeatLabel(ev.repeat, ev.date)})` : ''}`;
  }
  const { title, due, repeat, time } = parseQuickTask(text, new Date());
  if (!title) throw new Error('할일 내용을 알아듣지 못했어요');
  // 구글 태스크는 시간·반복을 넣을 수 없어요. 앱에만 따로 기억하지 않고, 넣지 않은 채 알려 드려요
  if (repeat || time) throw new Error('구글 태스크에는 시간·반복을 넣을 수 없어요. 일정(📅)으로 보내 주세요');
  const lists = await ctx.api().taskLists(false);
  const listId = lists.some((l) => l.id === ctx.gs.taskList) ? ctx.gs.taskList : lists[0]?.id;
  await googleFetch(at, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, { title, ...(due ? { due: toTaskDue(due) } : {}) });
  return `할일: ${title}${due ? ` · ${dueLabel(due, dayKey(new Date()))}` : ''}`;
}

const inbox = (await db.collectionGroup('inbox').get()).docs;
const byUser = new Map();
for (const d of inbox) {
  const userRef = d.ref.parent.parent; // users/{uid}
  if (!byUser.has(userRef.path)) byUser.set(userRef.path, { userRef, items: [] });
  byUser.get(userRef.path).items.push(d);
}
for (const { userRef, items } of byUser.values()) {
  const sec = (await userRef.collection('data').doc('secrets').get()).data() || {};
  const gs = (await userRef.collection('data').doc('main').get()).data()?.settings?.google || {};
  let at = null;
  const ctx = {
    gs,
    async accessToken() {
      if (at) return at;
      if (!sec.googleRefresh || !gs.clientId || !SECRET) throw new Error('구글 자동 동기화가 켜져 있어야 일정·할일을 넣을 수 있어요');
      at = (await token({ refresh_token: sec.googleRefresh, client_id: gs.clientId, client_secret: SECRET, grant_type: 'refresh_token' })).access_token;
      return at;
    },
    api: () => serverApi(at),
  };
  const done = [];
  const failed = [];
  for (const d of items.sort((a, b) => (a.data().at || 0) - (b.data().at || 0))) {
    try {
      const line = await handleInbox(userRef, d.data(), ctx);
      if (line) done.push(line);
      await d.ref.delete();
    } catch (e) {
      console.log('받은편지함 처리 실패:', e.message); // 내용은 남기지 않아요 (공개 로그)
      failed.push(e.message);
      // 세 번 넘게 실패하면 메모로라도 남기고 지워요
      const tries = (d.data().tries || 0) + 1;
      if (tries >= 3) { await handleInbox(userRef, { kind: '메모', text: `[넣지 못한 ${d.data().kind || ''}] ${d.data().text || ''}` }, ctx).catch(() => {}); await d.ref.delete(); }
      else await d.ref.update({ tries });
    }
  }
  console.log(`받은편지함: 넣음 ${done.length}개, 실패 ${failed.length}개`);
  if (done.length) await notify(userRef, '넣었어요', done.join('\n'));
  if (failed.length) await notify(userRef, '넣지 못했어요', [...new Set(failed)].join('\n'));
  if (ctx.warn) await notify(userRef, '단축어 설정을 확인해 주세요', ctx.warn);
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
    const { access_token: at, expires_in: ttl } = await token({ refresh_token: refresh, client_id: gs.clientId, client_secret: SECRET, grant_type: 'refresh_token' });
    // 앱이 일정·할일을 넣을 때 구글 창 없이 쓰도록, 1시간짜리 접근 토큰을 본인만 읽는 곳에 둬요 (로그에는 안 남겨요)
    await doc.ref.set({ googleAccess: { token: at, exp: Date.now() + (Number(ttl) || 3600) * 1000 } }, { merge: true });
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
    if (e.code === 'invalid_grant') await doc.ref.set({ googleRefresh: FieldValue.delete(), googleAccess: FieldValue.delete(), googleLinkError: '구글 연결이 끊겼어요 (만료·해제). 설정에서 자동 동기화를 다시 켜 주세요' }, { merge: true });
    else await doc.ref.set({ googleLinkError: `마지막 동기화 실패: ${e.message}` }, { merge: true });
  }
}
