/* Edit this file to brand the portal. No rebuild needed - upload it with the rest of the folder. */
window.HS_CONFIG = {
  brand: 'NextMONNet',                         /* shown in header, page titles and footer */
  tagline: 'Internet cepat, harga bersahabat',
  logo: 'img/logo.svg',                      /* path inside the html directory; replace the file or change the path */
  lang: 'id',                                /* 'id' | 'en' - dynamic messages (errors, status) */
  voucherMode: 'single',                     /* default login form: 'single' (one voucher code) | 'userpass' */
  allowModeSwitch: true,                     /* show the "Kode voucher | Username" switch */
  scan: true,                                /* show the QR scan button */
  support: {
    whatsapp: '6281234567890',               /* international format, digits only; '' hides the link */
    buyText: 'Belum punya voucher? Hubungi admin',
    hours: 'Setiap hari 08.00 - 22.00'       /* '' hides */
  },
  redirectDelaySec: 3,                       /* alogin.html: seconds before moving on after login */
  advert: {                                  /* radvert.html (only used if "advertise" is enabled on the router) */
    title: 'Terima kasih sudah memakai layanan kami',
    text: 'Promo paket mingguan tersedia. Tanyakan ke admin.',
    image: '',                               /* e.g. 'img/promo.jpg' */
    seconds: 5
  }
};
