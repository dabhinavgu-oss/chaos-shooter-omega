// Keep the original game client's click handler attached to the start button while
// the home/lobby layer replaces the visible menu around it.
document.addEventListener('DOMContentLoaded', () => {
  const play = document.getElementById('playBtn');
  if (!play) return;
  play.style.display = 'none';
  play.style.position = 'fixed';
  play.style.left = '-10000px';
  document.body.appendChild(play);
});