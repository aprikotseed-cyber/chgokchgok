// 휴대폰·PC에서 앱이 꺼져 있어도 비서 알림을 받기 위한 서비스 워커.
// 서비스 워커에서는 js/store.js를 불러올 수 없어서 Firebase 설정값을 한 번 더 적어 둡니다.
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
