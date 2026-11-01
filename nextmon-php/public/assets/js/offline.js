/* Static offline page: picks id/en from the stored NextMON language cookie or browser language. */
(function () {
  var m = document.cookie.match(/(?:^|; )klang=(\w+)/);
  var lang = m ? m[1] : (navigator.language || 'id').slice(0, 2);
  if (lang === 'en') {
    document.documentElement.lang = 'en';
    document.getElementById('t').textContent = 'You are offline';
    document.getElementById('m').textContent = 'NextMON needs a connection to your server. Reconnect and try again.';
    document.getElementById('r').textContent = 'Retry';
  }
  window.addEventListener('online', function () { location.reload(); });
})();
