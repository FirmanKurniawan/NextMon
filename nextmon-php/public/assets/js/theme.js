/* Runs in <head> before first paint: apply stored theme / accent / density / sidebar without flashing. */
(function () {
  try {
    var d = document.documentElement, s = localStorage;
    d.setAttribute('data-theme', s.getItem('nextmon-theme') || 'auto');
    var a = s.getItem('nextmon-accent'); if (a && a !== 'teal') d.setAttribute('data-accent', a);
    d.setAttribute('data-density', s.getItem('nextmon-density') === 'comfortable' ? 'comfortable' : 'compact');
    if (s.getItem('nextmon-sb') === 'collapsed') d.setAttribute('data-sb', 'collapsed');
  } catch (e) { /* storage blocked: stay on defaults */ }
})();
