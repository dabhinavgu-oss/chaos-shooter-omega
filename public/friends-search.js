(() => {
  const TOKEN_KEY = 'cso_token';
  let mounted = false;

  async function searchPlayers(q) {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const r = await fetch('/api/friends/search?q=' + encodeURIComponent(q), {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Search failed');
    return data;
  }

  function mount() {
    const input = document.getElementById('friendName');
    const send = document.getElementById('sendFriend');
    if (!input || !send || input.dataset.searchReady) return;
    input.dataset.searchReady = '1';

    const box = document.createElement('div');
    box.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:8px';
    box.innerHTML = `
      <input id="friendSearch" class="csoInput" placeholder="Search players by username" maxlength="16" autocomplete="off">
      <div id="friendSearchResults" class="csoList"></div>
    `;
    send.parentNode.insertBefore(box, send);

    const search = document.getElementById('friendSearch');
    const results = document.getElementById('friendSearchResults');
    let timer = null;

    search.addEventListener('input', () => {
      clearTimeout(timer);
      const q = search.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = '<p class="csoMuted">SEARCHING...</p>';
      timer = setTimeout(async () => {
        try {
          const players = await searchPlayers(q);
          results.innerHTML = players.length ? players.map(p => {
            const action = p.status === 'friends' ? '<span class="online">FRIENDS</span>'
              : p.status === 'sent' ? '<span class="offline">REQUEST SENT</span>'
              : p.status === 'received' ? '<span class="offline">REQUEST WAITING</span>'
              : `<button class="csoSmall" data-add-player="${p.id}" data-add-name="${String(p.username).replace(/"/g, '&quot;')}">ADD FRIEND</button>`;
            return `<div class="csoItem"><span>${p.username}</span>${action}</div>`;
          }).join('') : '<p class="csoMuted">No registered players found.</p>';

          results.querySelectorAll('[data-add-player]').forEach(btn => {
            btn.onclick = async () => {
              try {
                const username = btn.dataset.addName;
                const token = localStorage.getItem(TOKEN_KEY) || '';
                const r = await fetch('/api/friends/request', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                  body: JSON.stringify({ targetUsername: username })
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error || 'Request failed');
                btn.replaceWith(Object.assign(document.createElement('span'), { className: 'offline', textContent: 'REQUEST SENT' }));
                input.value = username;
              } catch (e) {
                results.innerHTML = '<p class="csoMuted">' + e.message.replace(/[&<>]/g, '') + '</p>';
              }
            };
          });
        } catch (e) {
          results.innerHTML = '<p class="csoMuted">Could not search players.</p>';
        }
      }, 250);
    });
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
