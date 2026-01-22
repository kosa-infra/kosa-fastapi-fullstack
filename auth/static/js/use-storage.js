// 로그인 상태 확인 및 저장
function saveLoginState(username) {
  const userData = {
    isLogin: true,
    username: username,
    timestamp: Date.now(),
  };
  localStorage.setItem("user", JSON.stringify(userData));
  console.log("로그인 상태 저장됨:", userData);
}

// 로그아웃
function logout() {
  localStorage.removeItem("user");
  console.log("로그아웃됨");
}

// 로그인 상태 가져오기
function getLoginState() {
  const userData = localStorage.getItem("user");
  return userData ? JSON.parse(userData) : null;
}

// 페이지 로드 시 로그인 상태 확인
document.addEventListener("DOMContentLoaded", function () {
  const user = getLoginState();
  if (user && user.isLogin) {
    showLoginStatus(user.username);
  }
});

// 로그인 상태 표시
function showLoginStatus(username) {
  const nav = document.querySelector("nav");
  nav.innerHTML = `
        <span style="color: green;">${username}님 환영합니다!</span> |
        <a href="#" onclick="logout(); location.reload();">로그아웃</a>
    `;
}
