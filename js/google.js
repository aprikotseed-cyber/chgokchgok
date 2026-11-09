// 구글 캘린더·구글 태스크 연결 (브라우저에서 바로).
// 구글 공식 로그인 도구(Google Identity Services)로 1시간짜리 접근 토큰을 받아 API를 불러요.
// 토큰은 이 탭이 열려 있는 동안만 기억해요 (sessionStorage). 비밀번호는 앱이 보지 않아요.

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly', // 1단계: 일정 읽기
  'https://www.googleapis.com/auth/tasks',              // 할일 읽기·쓰기
].join(' ');

const TOKEN_KEY = 'chgok-gtoken';
const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';

let gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('구글 로그인 도구를 불러오지 못했어요'));
    document.head.append(s);
  });
  return gisLoading;
}

function cachedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() + 60_000 ? t.token : null;
  } catch { return null; }
}

/** 구글 연결 도우미. clientId는 구글 클라우드 콘솔에서 만든 'OAuth 클라이언트 ID'(공개값) */
export function createGoogle(clientId) {
  let client = null;
  let pending = null;

  async function requestToken(prompt) {
    if (!clientId) throw new Error('먼저 설정에서 구글 클라이언트 ID를 넣어 주세요');
    await loadGis();
    client ||= window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
    pending ||= new Promise((resolve, reject) => {
      client.callback = (r) => {
        pending = null;
        if (r.error) return reject(new Error(r.error === 'access_denied' ? '구글 연결을 허용하지 않았어요' : `구글 연결 오류 (${r.error})`));
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }));
        resolve(r.access_token);
      };
      client.error_callback = (e) => { pending = null; reject(new Error(e?.type === 'popup_closed' ? '구글 연결 창이 닫혔어요' : '구글 연결 창을 열지 못했어요 (팝업 차단 확인)')); };
      client.requestAccessToken({ prompt });
    });
    return pending;
  }

  /** interactive=false면 저장된 토큰이 있을 때만 (없으면 null) */
  async function token(interactive) {
    const t = cachedToken();
    if (t) return t;
    if (!interactive) return null;
    return requestToken(localStorage.getItem('chgok-gconsented') ? '' : 'consent').then((x) => { localStorage.setItem('chgok-gconsented', '1'); return x; });
  }

  async function api(url, opt = {}, interactive = true) {
    let t = await token(interactive);
    if (!t) throw Object.assign(new Error('구글에 다시 연결해 주세요'), { needsAuth: true });
    const go = (tok) => fetch(url, { ...opt, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    let res = await go(t);
    if (res.status === 401 && interactive) { sessionStorage.removeItem(TOKEN_KEY); t = await requestToken(''); res = await go(t); }
    if (res.status === 204) return null;
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({})))?.error?.message || res.status;
      throw new Error(res.status === 403 ? `구글 API 권한 오류: ${msg} (콘솔에서 Calendar API·Tasks API를 켰는지 확인)` : `구글 오류: ${msg}`);
    }
    return res.json();
  }

  /** 여러 쪽으로 나뉜 목록 모두 받기 */
  async function all(url, interactive) {
    const items = [];
    let pageToken = '';
    for (let i = 0; i < 10; i++) {
      const r = await api(`${url}${url.includes('?') ? '&' : '?'}${pageToken ? `pageToken=${encodeURIComponent(pageToken)}` : ''}`, {}, interactive);
      items.push(...(r.items || []));
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }
    return items;
  }

  return {
    connected: () => !!cachedToken(),
    connect: () => token(true),
    disconnect() {
      const t = cachedToken();
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('chgok-gconsented');
      if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
    },
    calendars: (i = true) => all(`${CAL}/users/me/calendarList?minAccessRole=reader`, i),
    events: (calId, timeMin, timeMax, i = true) => all(`${CAL}/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`, i),
    taskLists: (i = true) => all(`${TASKS}/users/@me/lists?maxResults=100`, i),
    // 완료한 일도 함께 받아요 (오래된 완료 항목은 앱에서 걸러요)
    tasks: (listId, i = true) => all(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`, i),
    addTask: (listId, body) => api(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
    patchTask: (listId, id, body) => api(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteTask: (listId, id) => api(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
