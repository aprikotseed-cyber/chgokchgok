// ============================================================
// 여기에 덕준님의 Firebase 프로젝트 설정값을 넣어주세요.
// Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱 에서 확인 가능합니다.
// 끄적끄적/육삼레벨업과 같은 Firebase 프로젝트를 써도 되고,
// 완전히 새 프로젝트를 만들어도 됩니다 (새 프로젝트를 추천드려요 - 데이터 분리).
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCE1mr4FhWg9-3slbSNy_VjqfKLh9kzaSI",
  authDomain: "chgokchgok.firebaseapp.com",
  projectId: "chgokchgok",
  storageBucket: "chgokchgok.firebasestorage.app",
  messagingSenderId: "185892318993",
  appId: "1:185892318993:web:52984f7d174bbf362ee6b0"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// 이 앱은 오직 덕준님 한 분만 로그인해서 쓰는 완전 비공개 앱입니다.
// Firebase 콘솔 > Authentication > Sign-in method 에서 "이메일/비밀번호"를 켜고,
// Authentication > Users 에서 본인 이메일 계정을 딱 1개만 직접 추가해주세요.
// (회원가입 화면은 만들지 않았습니다 - 아무나 가입 못하게 하기 위해서예요.)
