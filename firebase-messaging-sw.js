// 휴대폰·PC에서 앱이 꺼져 있어도 비서 알림을 받기 위한 서비스 워커.
// 서비스 워커에서는 js/store.js를 불러올 수 없어서 Firebase 설정값을 한 번 더 적어 둡니다.
// 차곡차곡을 화면에 띄워 둔 기기에서는 Firebase가 알림을 띄우지 않고 앱 화면에만 넘겨요.
// 앱은 그걸 보여 주지 않으니, 그때는 여기서 직접 띄워요. (앱이 안 보일 때는 아래 Firebase가 띄워요)
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { return; }
  const n = p.notification;
  if (!n) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (!list.some((c) => c.visibilityState === 'visible')) return null;
    return self.registration.showNotification(typeof n.title === 'string' ? n.title : '차곡차곡', { // 빈 제목도 그대로 (시험용)
      body: n.body, icon: n.icon, tag: n.tag, renotify: !!n.tag, requireInteraction: n.requireInteraction === true || n.requireInteraction === 'true',
      data: { link: (p.fcmOptions && p.fcmOptions.link) || './' },
    });
  }));
});
self.addEventListener('notificationclick', (event) => {
  const link = event.notification.data && event.notification.data.link;
  if (!link) return; // Firebase가 띄운 알림은 Firebase가 처리해요
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : clients.openWindow(link);
  }));
});

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCE1mr4FhWg9-3slbSNy_VjqfKLh9kzaSI',
  authDomain: 'chgokchgok.firebaseapp.com',
  projectId: 'chgokchgok',
  storageBucket: 'chgokchgok.firebasestorage.app',
  messagingSenderId: '185892318993',
  appId: '1:185892318993:web:52984f7d174bbf362ee6b0',
});

// 알림 표시와 클릭 시 앱 열기는 Firebase가 처리해요 (scripts/notify.mjs의 webpush.notification / fcmOptions.link)
firebase.messaging();
