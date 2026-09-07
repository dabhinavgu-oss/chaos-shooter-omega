(() => {
  const key = 'cso_token';
  const auth = () => {
    const t = localStorage.getItem(key) || '';
    return t ? { Authorization: 'Bearer ' + t } : {};
  };

  async function refresh() {
    const input = document.getElementById('friendName');
    if (!input) return;
    try {
      const r = await fetch('/api/friends/pending?_=' + Date.now(), { cache: 'no-store', headers: auth() });
      if (!r.ok) return;
      const pending = await r.json();
      const panels = document.querySelectorAll('#startScreen .csoGrid > .csoPanel');
      if (panels.length < 2) return;
      const lists = panels[1].querySelectorAll('.csoList');
      const list = lists[0];
      if (!list) return;
      list.innerHTML = pending.length ? pending.map(f =>
        '<div class="csoItem"><span>' + safe(f.username) + '</span><button class="csoSmall" data-live-accept="' + Number(f.id) + '">ACCEPT</button></div>'
      ).join('') : '<p class="csoMuted">No pending requests.</p>';
      list.querySelectorAll('[data-live-accept]').forEach(btn => {
        btn.onclick = async () => {
          btn.disabled = true;
          const r2 = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, auth()),
            body: JSON.stringify({ fromUserId: Number(btn.dataset.liveAccept) })
          });
          if (r2.ok) {
            await refresh();
          } else {
            btn.disabled = false;
          }
        };
      });
    } catch (_) {}
  }

  function safe(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function watch() {
    const b = document.getElementById('friendsTab');
    if (b && !b.dataset.liveFriends) {
      b.dataset.liveFriends = '1';
      const old = b.onclick;
      b.onclick = async () => {
        if (old) old();
        setTimeout(refresh, 50);
      };
    }
    if (document.getElementById('friendName')) refresh();
  }

  const observer = new MutationObserver(watch);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watch();
  setInterval(watch, 2000);
})();