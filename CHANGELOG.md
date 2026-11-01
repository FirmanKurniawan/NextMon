# Changelog
Format mengikuti [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]
### Added
- Riset Mikhmon v3/v4 dan rencana proyek (`docs/PLAN.md`), `AGENTS.md`, `MEMORY.md`, README, LICENSE.
- `docs/FEATURES.md`, `docs/ARCHITECTURE.md`, `docs/mikrotik-scripts/` (skrip `.rsc` belum diverifikasi di router).
- `shared/hotspot-login/` — template login hotspot (CHAP md5, voucher satu kolom, QR scan) dan `shared/voucher-templates/` (A4 grid, glass card, thermal 58/80, generator QR). Teruji di node + Chrome headless, belum di router.
- `nextmon-php/` (~6.800 baris) — dashboard, router, user/profile/voucher, laporan CSV/XLS, POS, tools, backup, queue, firewall, notifikasi, REST API, halaman status voucher, PWA, i18n id/en, preview desain statis. **PHP belum pernah dijalankan** (hanya cek sintaks).
### Changed
- Performa frontend (PHP): build aset ber-hash + minify (`node bin/build-assets.js`, `public/assets/dist/`, helper `asset()`), cache immutable + .br/.gz (php -S lewat `public/index.php`, nginx/Apache/IIS di `deploy/`), `charts.js`/`qr.js`/`pages.js` hanya dimuat di halaman yang butuh, service worker pre-cache manifest build. Tampilan identik (diff piksel).
- Arah desain: aksen tunggal biru-teal, glass terkendali (bukan neon/aurora).
- Performa backend (PHP, router jauh): socket router persisten + lazy connect, pipelining tag API (dasbor/halaman/voucher/hapus massal/impor), cache baca singkat dengan invalidasi per-tulis, SWR dasbor, circuit breaker, sesi dilepas awal, tuning SQLite, rute/bahasa terkompilasi, gzip jarak jauh; skrip `bin/serve.*` (OPcache), `bin/perf.php` + `tests/fixtures/fake_router_server.php`, tes `tests/unit/PerfTest.php` + `tests/perf_http.php`. Hasil ukur emulasi: 13 halaman 6,9 dtk -> 2,0 dtk (pertama) / 0,2 dtk (ulang); 100 voucher 13,4 dtk -> 0,55 dtk. **Belum diuji pada MikroTik asli.** Lihat README "Performa & deployment".
### Pending
- `nextmon-next/` ditunda sampai desain & fitur PHP disetujui.

### Ronde 2 (PHP)
- UI redesain: compact, glass berlapis, tema aksen, dasbor bento, palet perintah, shortcut.
- 9 desain voucher glass + QR SVG (terverifikasi decode 1728/1728 via jsQR), panel cetak dengan preset.
- Reseller (wallet, komisi, ledger), impor/ekspor CSV, pengaturan keamanan (kebijakan password, sesi, riwayat login).
- Monitor router + cron, PPPoE/DHCP/ARP/walled garden, wizard setup router.
- Toko publik + payment (Manual, Mock, Midtrans, Tripay, Xendit), pesanan admin.
- Storage SQLite (fallback JSON) + 68 tes unit + smoke test 88 request.
- Dihapus: 2FA TOTP (dibatalkan pengguna).

### Ronde 3 — poles (PHP)
- Nama produk: **NextMON** (sebelumnya Kilat). Folder `nextmon-php`, env `NEXTMON_*`.
- Voucher: 11 desain, teks merek tidak terpotong, charset anti-ambigu, ESC/POS (QR native/raster) untuk thermal, hasil cetak PDF diverifikasi (halaman, margin, decode QR).
- UI: delta "—" saat 0, transisi skeleton, spinner submit, empty state, rapikan mobile.
- PWA: ikon PNG, service worker v3 aman (tanpa cache HTML), halaman offline, toast update.
- Aksesibilitas (axe), audit i18n + glosarium, tes matriks peran (127 route).
- Keamanan: IDOR voucher reseller, sanitiser template, SSRF webhook, IP proxy tepercaya, open redirect, injeksi skrip, header CSP/HSTS, hardening klien RouterOS, rotasi kunci (`bin/nextmon.php crypto:rotate`), konfigurasi nginx/Apache/IIS.
- Tes: 103 unit, smoke 88 (SQLite+JSON), security_http 86, roles 1215 assertion, shop 42, ESC/POS 12, SW.

### Ronde 4 — performa (PHP)
- Backend: socket RouterOS dipakai ulang, pipelining perintah, cache baca per router (invalid otomatis saat tulis), circuit breaker, lock sesi dilepas awal, SQLite tuning, rute/bahasa terkompilasi. Emulasi router jauh (120 ms/balasan): buat 100 voucher ~13,4 dtk → ~0,5 dtk; dasbor ~1,2 dtk → ~0,2 dtk (pertama) / 12 ms (cache). Belum diuji ke MikroTik asli.
- Frontend: aset di-minify + hash + brotli/gzip + cache immutable (app.css 62 KB → ~10 KB br), JS per halaman, QR encoder ~2,4× lebih cepat, polling berhenti saat tab tersembunyi.
- Voucher: escpos dimuat saat dipakai, render slider digabung per frame, thumbnail saat idle, content-visibility pada lembar, cache sanitasi template.
- Peluncur `start-php` kini memakai `bin/serve.ps1` (OPcache + router script). `php -S` tetap satu thread di Windows.

### Logo
- Logo NextMON: huruf **N** dengan dua busur sinyal di ujung kanan atas, di atas tile teal (bukan petir). Sempat dicoba versi hati terbelah N M; pengguna memilih kembali ke logo N ini. Sumber: `brand/` (`gen-logo.py`, `build-icons.js`).
- Terpasang di: sidebar/drawer, halaman login & setup, toko publik, status voucher, favicon + ikon PWA, template login hotspot, README. Glyph di aplikasi inline (`brand_mark()`), ikut warna aksen.
- Perbaikan: `layout.php` rusak (blok skrip duplikat tanpa `$`); hitungan user per profil tidak error saat field `profile` kosong.

### Fondasi Next.js & Server (belum rilis)
- `nextmon-next/`: fondasi multi-tenant (Store fail-closed, auth, RouterOS client, driver, SSE traffic bersama, shell UI memakai CSS PHP). 130 tes vitest lulus, build OK. Kemudian dilengkapi semua modul fitur (hotspot, voucher, POS, laporan, reseller, jaringan, monitor, tools, backup, penjadwal, router/platform/wizard, pengaturan, toko/pesanan/status): 240 tes, build produksi OK; belum diuji di router asli.
- `nextmon-server/ui` + `tools/mock-server.mjs`: panel kontrol web (diuji dengan server tiruan; server Rust belum teruji).
- `nextmon-php/tests/tenant_isolation_test.php`: suite isolasi antar-akun.
- Multi-akun (PHP): workspace per pemilik, halaman platform, berbagi router ro/rw, migrasi data lama ke `main`. Suite isolasi 19 area lulus (json). Batas voucher/hari dan log belum diberlakukan.
- NextMON Server (Rust): exe 0.1.0 dengan supervisor, API kontrol, tray, CLI, backup. Port kontrol bawaan 47878.
