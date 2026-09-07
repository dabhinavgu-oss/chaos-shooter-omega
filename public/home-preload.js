// Keep the original game client's click handler attached to the start button while
// the home/lobby layer replaces the visible menu around it.
document.addEventListener('DOMContentLoaded', () => {
  const play = document.getElementById('playBtn');
  if (play) {
    play.style.display = 'none';
    play.style.position = 'fixed';
    play.style.left = '-10000px';
    document.body.appendChild(play);
  }

  // Google OAuth returns to /#google_token=... so the token never travels back
  // to the server in the URL request. Store it in the same client auth storage
  // used by the normal login flow.
  const finishGoogleLogin = () => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const token = params.get('google_token');
    const username = params.get('google_user');
    const error = params.get('google_error');
    if (error) {
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => alert(error), 0);
      return;
    }
    if (!token || !username) return;
    localStorage.setItem('cso_token', token);
    localStorage.setItem('cso_user', JSON.stringify({ username }));
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  };
  finishGoogleLogin();

  const addGoogleButton = () => {
    const authGo = document.getElementById('authGo');
    const authSwitch = document.getElementById('authSwitch');
    if (!authGo || !authSwitch || document.getElementById('googleLoginBtn')) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:10px;text-align:center';
    wrap.innerHTML = '<button id="googleLoginBtn" class="csoTab" style="width:100%;background:#fff;color:#222;border-color:#fff">CONTINUE WITH GOOGLE</button>';
    authGo.parentNode.parentNode.appendChild(wrap);
    document.getElementById('googleLoginBtn').onclick = () => { location.href = '/api/auth/google'; };
  };
  addGoogleButton();
  new MutationObserver(addGoogleButton).observe(document.body, { childList: true, subtree: true });
});