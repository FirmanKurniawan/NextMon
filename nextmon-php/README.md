# NextMON (versi PHP) - pengelola hotspot MikroTik

PHP 8.1 polos + JavaScript vanilla + HTML + CSS. Tanpa framework, tanpa Composer, tanpa CDN. Jalan di XAMPP, hosting
bersama, Linux, Android (Termux), atau Docker.

> **STATUS: teruji di mode demo saja.** Sudah dijalankan di PHP 8.4: lint seluruh file, 68 tes unit, smoke test 88 request tanpa error,
> dan tampilan di browser. **Belum diuji** terhadap router MikroTik asli, gateway payment live, maupun cetak ke kertas.
> Jalankan dulu dengan mode demo, lalu uji ke router lab sebelum produksi.

## Persyaratan

- PHP 8.1+ dengan ekstensi `openssl` (wajib: enkripsi password router), `curl` (opsional: notifikasi), `mbstring`, `json`.
- MikroTik RouterOS v6.3x - v7.x dengan service **API** (8728) atau **API-SSL** (8729) aktif. Lisensi level 4 ke atas
  untuk hotspot lebih dari 1 user aktif pada perangkat tertentu (sesuai aturan MikroTik).
- **SNTP/NTP client di router harus aktif.** Masa berlaku voucher (scheduler expiry) dihitung dari jam router.

## Menjalankan

```bash
# dari folder induk repo
php -S localhost:8080 -t nextmon-php/public nextmon-php/public/index.php
# paksa mode demo untuk semua router
NEXTMON_DEMO=1 php -S localhost:8080 -t nextmon-php/public nextmon-php/public/index.php      # Windows: set NEXTMON_DEMO=1
```

Di Windows lebih cepat dengan `bin\serve.cmd` (OPcache + realpath cache aktif; opsi `-Port`, `-Demo`) - lihat "Performa & deployment".

Buka `http://localhost:8080`. Saat pertama kali, NextMON meminta Anda **membuat akun admin** (tidak ada password bawaan).
Router bernama **Demo Router** dibuat otomatis sehingga seluruh UI dapat dicoba tanpa perangkat.

### Windows (XAMPP)
1. Salin folder `nextmon-php` ke `C:\xampp\htdocs\nextmon`.
2. Aktifkan `extension=openssl` (dan `curl`) di `php.ini` bila belum.
3. Arahkan Apache ke `...\nextmon\public` (VirtualHost) atau buka `http://localhost/nextmon/public/`. `.htaccess` di `public/`
   memerlukan `mod_rewrite` dan `AllowOverride All`.

### Linux
`sudo apt install php-cli php-curl php-mbstring` lalu jalankan perintah `php -S` di atas, atau pasang Nginx/Apache
dengan root `nextmon-php/public` dan fallback ke `index.php`
(`try_files $uri /index.php?$query_string;`).

### Android (Termux)
```bash
pkg install php
php -S 0.0.0.0:8080 -t nextmon-php/public
```
Buka `http://IP-HP:8080` dari perangkat lain di jaringan yang sama.

### Hosting bersama
Unggah semua isi `nextmon-php/`. Idealnya set document root domain ke `public/`. Jika tidak bisa, `.htaccess` di akar
meneruskan ke `public/` dan memblokir `src/`, `lang/`, `data/`. Pastikan `data/` dapat ditulis oleh PHP.

### Docker
```bash
docker build -t nextmon ./nextmon-php
docker run -p 8080:8080 -v nextmon-data:/app/data -e NEXTMON_DEMO=1 nextmon
```
(Dockerfile belum diuji.) Volume `data/` menyimpan akun, router, dan kunci enkripsi.

## Mode demo

- Otomatis: router "Demo Router" dibuat pada run pertama. Router bertipe *Demo* memakai `src/Demo.php`
  (data palsu: user, profil, sesi aktif, penjualan 45 hari, trafik, antrean, dll.). Perubahan disimpan di
  `data/demo-<id>.json`; hapus berkas itu untuk mereset.
- `NEXTMON_DEMO=1` memaksa **semua** router memakai simulator (berguna untuk demo publik).

## Menyiapkan router

```
/ip service enable api            ;# atau api-ssl
/ip service set api address=IP.SERVER.NEXTMON/32
/user group add name=nextmon policy=api,read,write,policy,test,sniff,!local,!telnet,!ssh,!ftp,!reboot,!winbox,!password,!web,!sensitive
/user add name=nextmon group=nextmon password=GANTI-INI
```
Lalu di NextMON: **Router > Tambah router**, isi host/port/user/password, klik **Tes koneksi**. Password disimpan terenkripsi
AES-256-GCM (kunci di `data/secret.key`, dibuat otomatis). Login mendukung RouterOS v6.43+ (plain) dan v6 lama (MD5 challenge).

Profil hotspot memakai skrip on-login buatan NextMON (mode `rem`, `ntf`, `remc`, `ntfc`; kunci MAC/server). Skrip mencatat
penjualan ke `/system script` dalam **format Mikhmon** (`date-|-time-|-user-|-price-|-ip-|-mac-|-validity-|-profile-|-comment`)
sehingga laporan dan data lama Mikhmon tetap terbaca.

*Validity* (masa aktif sejak login pertama) berbeda dari *Time limit* (`limit-uptime`, total lama online). NextMON menolak
time limit yang melebihi validity profil.

## Fitur

Dashboard (resource, trafik langsung canvas, sesi aktif, pendapatan hari/bulan, sparkline, live report, log hotspot & aplikasi) -
Router multi (tambah/ubah/tes) - User hotspot (CRUD, filter, hapus massal, kick, aktif/nonaktif) - Profil (CRUD, generator
skrip on-login, harga, validity, kunci MAC/server) - Generator voucher (batch, prefix, panjang, karakter, user=pass / user+pass,
komentar batch) dengan tampilan cetak + QR (generator QR sendiri di `qr.js`, tanpa CDN), editor template voucher (HTML + placeholder),
cetak thermal (RawBT intent / Web Bluetooth ESC/POS) - Sesi aktif, Host, IP binding - Laporan penjualan (filter hari/bulan/tahun/profil,
grafik, ekspor CSV & XLS) - POS jual cepat + struk 58mm + pemindai QR kamera (BarcodeDetector) - Alat (ping, traceroute, torch,
kesehatan sistem, log) - Backup (buat .backup/.rsc di router, unduh CSV user, JSON profil, JSON pengaturan) - Queue sederhana -
Address-list firewall (blokir IP + pasang aturan drop) - Pengaturan, user dasbor + peran, kunci API - Log audit -
Notifikasi Telegram + webhook - Halaman publik cek status voucher - PWA (manifest + service worker) - i18n id/en -
tema gelap/terang/otomatis - palet perintah `Ctrl+K`.

### Peran
`admin` (semua) - `operator` (kelola hotspot, tanpa pengaturan/router/kunci) - `reseller` (jual voucher/POS, lihat) - `viewer` (baca saja).

### REST API
Buat kunci di **Pengaturan > Kunci API** (ditampilkan sekali; hanya hash SHA-256 yang disimpan).
```
curl -H "X-API-Key: kl_..." http://host:8080/api/v1/status
curl -H "X-API-Key: kl_..." "http://host:8080/api/v1/sales?period=month"
curl -X POST -H "X-API-Key: kl_..." -H "Content-Type: application/json" \
     -d '{"profile":"1Jam","qty":5}' http://host:8080/api/v1/vouchers      # scope write
```
Sumber daya: `status users profiles active hosts sales logs health interfaces`, `POST vouchers`, `POST kick`. Pilih router dengan `?router=ID`.

### Halaman status voucher (publik)
`/status?session=NAMA-SESI` (nama sesi diatur per router). JSON: `/status.json?session=..&user=..` (CORS dibatasi ke host
router + origin tambahan di Pengaturan; rate limit 40 permintaan / 10 menit / IP). Contoh pemakaian dari `status.html` hotspot:
```js
fetch('http://SERVER-NEXTMON/status.json?session=cafe-a&user=' + encodeURIComponent(user)).then(r => r.json())
```
(Origin halaman hotspot harus tercantum di Pengaturan > Origin yang diizinkan.)

### Cetak thermal
Di tampilan cetak voucher dan POS: **RawBT** (membuka intent aplikasi RawBT di Android) atau **Bluetooth** (Web Bluetooth, Chrome,
HTTPS atau localhost; mencari karakteristik tulis BLE umum). ESC/POS 32 kolom (58 mm) atau 48 kolom (80 mm), QR dikirim sebagai perintah QR native (GS ( k) atau gambar raster.

## Catatan keamanan

Sudah ditinjau secara adversarial (XSS, CSRF, sesi, injeksi RouterOS, SSRF, berkas, header). Yang berlaku:

- Tidak ada kredensial bawaan; akun admin dibuat saat pertama kali. Password: bcrypt cost 12 (di-rehash otomatis saat login), maks. 72 byte.
  Di server yang bisa dijangkau publik set `NEXTMON_SETUP_TOKEN=rahasia` lalu buka `/setup?token=rahasia` sekali, agar orang asing tak bisa merebut akun admin pertama.
- CSRF token pada semua POST (kecuali `/pay/callback`, yang memakai tanda tangan gateway) + penolakan `Sec-Fetch-Site: cross-site` / `Origin` asing.
  Cookie sesi `HttpOnly` + `SameSite=Lax` (+ `Secure` bila HTTPS), `session.use_strict_mode`, ID sesi diganti saat login, timeout idle opsional (Pengaturan > Keamanan).
- Batas percobaan login: 5 gagal / 10 menit per (user, IP), 20 per IP, dan 30 per user dari semua IP. **IP klien** hanya dibaca dari `REMOTE_ADDR`;
  `X-Forwarded-For` / `X-Forwarded-Proto` dipercaya hanya dari proxy tepercaya: loopback, atau alamat di env `NEXTMON_TRUSTED_PROXIES="10.0.0.5,172.18.0.0/16"`.
  Tanpa itu di belakang proxy non-loopback, semua klien terlihat satu IP (limit dibagi bersama) dan cookie tidak diberi `Secure`.
  `NEXTMON_BASE_URL=https://nextmon.contoh.com` mengunci URL absolut (callback pembayaran, URL cron) terhadap manipulasi header Host.
- Header: CSP ketat (tanpa skrip inline), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (kamera hanya untuk situs ini, untuk pemindai QR),
  `COOP/CORP`, HSTS bila HTTPS, `Cache-Control: no-store` pada halaman dinamis.
- Password router, token Telegram, dan kunci gateway dienkripsi AES-256-GCM (IV acak 96-bit per nilai). Berkas kunci `data/secret.key` dibuat eksklusif dengan mode 0600.
  **Cadangkan** kunci itu. Rotasi: `php bin/nextmon.php crypto:rotate` (membuat kunci baru, mengenkripsi ulang semua rahasia, kunci lama disimpan sebagai `secret.key.bak-*` - hapus setelah yakin).
- Jangan membuka `data/` ke web (document root harus `public/`; lebih baik set `NEXTMON_DATA=/var/lib/nextmon` di luar folder kode). Contoh konfigurasi yang memblokir
  `data/ src/ lang/ bin/ tests/` : `deploy/nginx.conf`, `deploy/apache.conf`, `public/web.config` (IIS, root = public), `web.config` (IIS, root = folder proyek), `.htaccess`.
  Hardening php.ini: `deploy/php-hardening.ini`.
- Pratinjau import CSV (berisi password) disimpan terenkripsi di `data/cache/`, dihapus saat commit/batal/logout atau setelah 30 menit.
- Template voucher disaring dengan allow-list DOM (tag/atribut/CSS aman saja; tanpa skrip, iframe, form, `on*`, URL CSS eksternal) saat disimpan **dan** saat dimuat.
- Webhook notifikasi: hanya `http(s)` ke alamat publik. Alamat internal/loopback/link-local/CGNAT ditolak dan IP hasil resolusi dipaku (anti DNS-rebinding), tanpa redirect.
  Untuk mengizinkan webhook ke LAN (mis. n8n lokal) set `NEXTMON_ALLOW_PRIVATE_WEBHOOK=1`. TLS selalu diverifikasi.
- Klien API MikroTik: batas ukuran kata/balasan (8 MB / 64 MB / 200 rb baris), batas waktu total per permintaan, sambung ulang otomatis hanya bila tulis gagal sebelum terkirim.
  API-SSL: opsi `verify_tls` per router (butuh sertifikat sungguhan di router); defaultnya tanpa verifikasi karena API-SSL bawaan RouterOS memakai ADH tanpa sertifikat
  (terenkripsi tetapi tidak terautentikasi) - gunakan jaringan tepercaya.
- Kunci API: hanya hash SHA-256 yang disimpan, perbandingan konstan-waktu, rate limit 600 req/menit per kunci dan 30 kunci-salah/10 menit per IP. Scope `read` tidak bisa menulis.
- Peran: viewer/reseller tidak melihat password voucher di daftar user; reseller hanya bisa mencetak ulang batch yang dibuatnya sendiri; ping/traceroute/torch butuh peran operator ke atas.
- Token cron web dibandingkan konstan-waktu dan dibatasi percobaan salahnya; lebih baik kirim lewat header `X-Cron-Token` daripada `?token=` (query string masuk log akses).
- Docker: image berjalan sebagai `www-data`, tanpa tests/docs. Server bawaan PHP bukan server produksi: untuk internet pakai php-fpm + nginx dengan TLS.
- Batasi service API MikroTik hanya ke IP server NextMON dan pakai user API berhak minimum (wizard membuatnya). Pakai HTTPS (reverse proxy) di produksi.

## Struktur

```
public/            index.php, .htaccess, assets/{css,js}, icon.svg, preview/ (halaman statis design system)
src/               App, Auth, Store, Crypto, I18n, Audit, Notify, Driver, RouterOS, Demo, Scripts, Voucher, Sales, helpers,
                   Cache, CachedDriver, Pipe (lapisan kecepatan, lihat "Performa & deployment")
src/Controllers/   satu controller per area;  src/views/  templat PHP
lang/              id.php (en = bahasa sumber)
data/              JSON runtime (diabaikan git)
```

## Pratinjau tanpa PHP

Buka `public/preview/index.html` lewat server statis apa pun (mis. `python -m http.server -d nextmon-php/public 8099` lalu
`/preview/index.html`). Halaman ini memuat CSS/JS asli dan memperlihatkan semua komponen, grafik, kartu voucher dan QR.

## Belum lengkap / diketahui

- Jalur PHP sudah dijalankan pada mode demo (PHP 8.4) tetapi belum pada router asli; kemungkinan masih ada bug runtime.
- Penyimpanan: SQLite (bawaan bila pdo_sqlite aktif) dengan fallback JSON; data order toko berupa file.
- Teruji: lint, 68 tes unit, smoke 88 request (mode demo). Belum teruji: router MikroTik asli, gateway payment live (Midtrans/Tripay/Xendit), cetak ke kertas/printer, scan QR hasil cetak, animasi di Firefox/Safari.
- Belum ada: PNG ikon PWA 192/512, QR pada cetak thermal Bluetooth (hanya teks).
- Unduh `.rsc` lewat API bersifat upaya terbaik; berkas `.backup` biner harus diambil via FTP/Winbox.
- Skrip on-login memakai `$"mac-address"` dan format tanggal `mmm/dd/yyyy` (default RouterOS v6/v7); router dengan format tanggal
  lain perlu penyesuaian. Perilaku `next-run` untuk tanggal kedaluwarsa pada komentar user belum diverifikasi di perangkat.
- Ikon PWA hanya SVG (belum ada PNG 192/512), sehingga kriteria "dapat dipasang" di sebagian browser mungkin belum terpenuhi.
- Animasi latar "aurora" tidak dipakai; sesuai arahan desain terbaru, latar hanya tint statis satu warna.

## Performa & deployment

NextMON berbicara ke MikroTik lewat API (TCP 8728/8729). Untuk router yang jauh (RTT 100 ms+) hampir seluruh waktu halaman adalah
**jumlah round-trip ke router**, bukan CPU PHP. Optimasi di bawah tidak mengubah fungsi, tampilan, atau API publik (`Store`, `Driver`, helper).

### Yang dilakukan aplikasi

| Teknik | Efek | Kode |
|---|---|---|
| **Koneksi router dipakai ulang antar-request** (socket persisten, hanya bila terbukti milik kita, idle < 60 dtk, kredensial sama, tanpa byte tersisa) | tidak ada TCP connect + login per halaman (2+ round-trip; lebih banyak untuk api-ssl) | `RouterOS::enablePersistence` |
| **Lazy connect** | halaman yang tidak menyentuh router tidak membuka koneksi | `RouterOS::setCredentials` |
| **Pipelining (tag API)**: perintah independen dikirim sekaligus, 1 round-trip | dasbor 9 -> 1 round-trip; halaman user/voucher 5 -> 1; 100 voucher 101 -> 2; hapus batch, impor CSV, aksi massal sama | `Pipe::*`, `RouterOS::printMany/addMany/removeMany/...` |
| **Cache baca singkat** per router (APCu bila ada, else `data/cache`): resource 3 dtk, active 3 dtk, user hotspot 8 dtk, profile 30 dtk, identity 5 mnt, dll. Setiap tulis (add/set/remove/command non-baca) menaikkan *generation* router sehingga semua cache router itu **langsung** tidak berlaku; fetch yang berlomba dengan tulis tidak bisa menimpa data baru. Payload berisi password voucher dienkripsi di disk. | halaman berulang / paginasi / pencarian / banyak tab tanpa trafik ke router | `CachedDriver`, `Cache` |
| **Dasbor**: payload JSON di-cache 2,5 dtk; lebih tua (<90 dtk) -> dikirim **seketika** lalu di-refresh *setelah* respons terkirim (stale-while-revalidate) | polling dasbor ~0 ms | `DashboardController::cachedData`, `App::defer` |
| **Circuit breaker**: setelah gagal connect/login, 15 dtk berikutnya gagal seketika (bukan timeout 5 dtk per request). Connect-timeout 4 dtk | router mati tidak membekukan seluruh UI (php -S satu thread) | `RouterOS::enableBreaker` |
| **Sesi dilepas lebih awal** pada GET baca-saja (`/json/*`, daftar user, profil, laporan, ...): lock file sesi tidak ditahan selama I/O router; flash & CSRF tetap bekerja (sesi dibuka lagi hanya saat menulis) | XHR paralel tidak antre | `App::closeSession/openSession` |
| Laporan penjualan hanya mengambil `name` skrip (bukan `source`/`owner`) | payload `/system/script` jauh lebih kecil | `Sales::request` |
| SQLite: `cache_size` 8 MB, `temp_store=MEMORY`, statement di-reuse, indeks ekspresi log (action/ref/id), memo baca dokumen per-request | lebih sedikit query & decode JSON | `SqliteStore`, `Store::requestCache` |
| Tabel rute & kamus bahasa dikompilasi ke `data/cache` (invalid otomatis bila file berubah); `nav_items()` sekali per request | tanpa `glob()`/compile berulang | `App::routes`, `I18n::init` |
| gzip untuk klien non-loopback (`NEXTMON_GZIP=1` paksa, `=0` matikan) | halaman via internet lebih kecil | `App::maybeGzip` |
| `last used` API key ditulis maks. 1x/menit | tidak menulis dokumen setiap panggilan API | `ApiController` |

Pengaturan (env menang atas Pengaturan di `data/`; `0` mematikan fitur):
`NEXTMON_ROUTER_KEEPALIVE` (detik, default 60; 0 = tanpa socket persisten), `NEXTMON_ROUTER_FAIL_TTL` (15; 0 = tanpa breaker),
`NEXTMON_ROUTER_CONNECT_TIMEOUT` (4), `NEXTMON_RCACHE` (1; 0 = tanpa cache baca), `NEXTMON_PIPELINE` (1; 0 = satu perintah per round-trip),
`NEXTMON_GZIP`. Kunci setting yang sama: `router_keepalive`, `router_fail_ttl`, `router_connect_timeout`, `router_cache`.
Bersihkan cache kapan saja: `php bin/nextmon.php cache:clear`.

### Hasil ukur (emulasi router jauh)

Tanpa router asli: `tests/fixtures/fake_router_server.php` meniru API RouterOS (didukung data Demo, 2000 user + 3000 baris penjualan,
RTT 120 ms per balasan, bandwidth 2 MB/s) dan menghitung koneksi / login / kalimat API; `bin/perf.php` memuat halaman lewat HTTP dan membaca hitungannya.
`php -S` PHP 8.4 Windows, tanpa OPcache kecuali disebut. Angka = ms waktu server per request (wall clock), dari klien di mesin yang sama.

| Halaman | Sebelum (ms) | Sesudah, kunjungan pertama (ms) | Sesudah, ulang (cache) (ms) | Round-trip router sebelum -> sesudah |
|---|---|---|---|---|
| `/json/dashboard` (poll) | 1141-1505 | 599 (termasuk connect+login pertama) / 222 tanpa cache baca | 12 | 9 -> 1 (0 bila cache) |
| `/hotspot/users` | 894 | 401 | 24 | 5 -> 1 (0) |
| `/hotspot/profiles` | 569 | 214 | 16 | 4 -> 1 (0) |
| `/hotspot/active` | 409 | 146 | 15 | 3 -> 1 (0) |
| `/vouchers` | 751 | 250 | 22 | 5 -> 1 (0) |
| `/pos`, `/queues` | ~400 | ~145 | 14 | 3 -> 1 (0) |
| 13 halaman berurutan | 6923 | 2016 | 214 | 10 koneksi + 10 login -> 1 koneksi + 1 login |
| Buat 100 voucher | ~13400 | 548 | - | 103 -> 2 |
| Hapus batch 100 voucher | ~13300 | 624 | - | 103 -> 2 |

Dengan OPcache (lihat bawah) sisi PHP turun sekitar 3-4x lagi (mis. `/settings` 21 -> 6 ms; total 13 halaman ulang 214 -> 104 ms).
Catatan jujur: ini emulasi (satu mesin, latensi sintetis); **belum diuji terhadap MikroTik asli**, terutama socket persisten + pipelining
tag pada berbagai versi RouterOS (v6.43+ diasumsikan; v7 sama protokolnya). Matikan per fitur dengan env di atas bila ada anomali.

### Rekomendasi deployment

1. **`php -S` itu satu thread.** Satu request lambat (mis. router lambat) memblokir semuanya, termasuk polling dasbor. PHP_CLI_SERVER_WORKERS
   **tidak didukung di Windows** (butuh `fork`); di Linux/macOS/Termux `bin/serve.sh` memakai 4 worker. Di Windows untuk pemakaian nyata
   (lebih dari satu orang / dasbor terbuka sambil bekerja) pakai **XAMPP (Apache)**, **nginx + php-cgi/php-fpm**, atau **Caddy + php-cgi**
   (`php_fastcgi`); NextMON aman multi-proses (sesi file, SQLite WAL, cache atomic).
2. **Aktifkan OPcache** (`zend_extension=opcache` di `php.ini`; DLL sudah ada di build Windows). Cara cepat: `bin\serve.cmd`
   (`-Demo`, `-Port 8080`) atau salin `deploy/php-opcache.ini`. Nilai kunci: `opcache.enable=1`, `memory_consumption=128`,
   `interned_strings_buffer=16`, `max_accelerated_files=4000`, `validate_timestamps=1` + `revalidate_freq=2` (dev) / `validate_timestamps=0`
   (produksi, reload php-fpm saat deploy), **JIT mati** (`opcache.jit=off`; tidak ada manfaat untuk beban I/O ini).
3. `realpath_cache_size=4096K`, `realpath_cache_ttl=600` (stat() Windows lambat).
4. Pakai **api-ssl hanya bila perlu**: handshake TLS menambah round-trip; socket persisten menutup sebagian besar biayanya.
5. Letakkan NextMON **dekat router** (VPS di jaringan yang sama / VPN dengan RTT rendah) bila memungkinkan: itu pengali terbesar.
6. `cron.php` memakai `flock` (tidak tumpang-tindih) dan menyapu file cache kedaluwarsa.

### Uji regresi performa

`php tests/run.php Perf` (cache, invalidasi, pipelining, persistensi, breaker, bulk) dan `php tests/perf_http.php` (HTTP end-to-end:
satu koneksi untuk banyak halaman, cache tidak pernah basi setelah tulis, flash/CSRF, voucher pipelined, SWR dasbor, gzip, breaker).
Ukur sendiri: jalankan `fake_router_server.php --port=18728 --latency=120 --users=2000 --sales=3000`, `bin/perf.php setup 18728`, lalu `bin/perf.php run <url> 18728`.

## Penyimpanan data & pengujian

- **Penyimpanan**: SQLite (`data/nextmon.db`, mode WAL) dipakai otomatis bila `pdo_sqlite` aktif; jika tidak, file JSON di `data/`.
  Paksa dengan env `NEXTMON_STORAGE=json|sqlite` atau isi file `data/storage.conf`. Saat pertama kali memakai SQLite, file JSON/log lama
  diimpor satu kali (salinan cadangan di `data/backup-json-<waktu>/`, file asli tidak dihapus).
- CLI: `php bin/nextmon.php storage:status | storage:migrate [--force] | storage:vacuum`.
- API `Store` tidak berubah (`read/write/update/setting/appendLog/tailLog`); tambahan: `has/delete/names/append/rows/count/prune`.
  Koleksi yang bertambah terus (log audit, notifikasi, buku besar) disimpan per baris sehingga tidak menulis ulang seluruh file.
- Tes: `php tests/run.php` (unit) dan `php tests/smoke.php` (HTTP, mode demo); atau `bin/test.sh` / `bin\test.cmd`.

## Penjadwal, Monitor, PPPoE/DHCP/ARP/Walled garden, Wizard (modul jaringan)

Halaman baru: `/monitor`, `/pppoe`, `/dhcp`, `/arp`, `/walledgarden`, `/wizard` (menu Jaringan). Kode: `src/Scheduler.php`, `src/Monitor.php`,
`src/Controllers/{Monitor,Network,Wizard}Controller.php`, `src/DemoNet.php` (data demo), `public/assets/css/mod-network.css`.
**Jalur router sungguhan belum diuji** pada perangkat; seluruh pengujian memakai mode demo (`Demo`/`DemoNet`).

### Pasang cron / Task Scheduler (wajib agar Monitor, alert, dan backup terjadwal berjalan)

`cron.php` dipanggil **tiap menit** (atau tiap 5 menit). Tiap tugas menentukan sendiri apakah sudah waktunya
(`poll` tiap 5 mnt, `stock` tiap 30 mnt, `backup` harian/mingguan pada jam yang diatur di Monitor > Aturan peringatan).
Kunci `data/cron.lock` mencegah dua proses berjalan bersamaan (kode keluar 3 bila terkunci).

```bash
# Linux / hosting dengan crontab (crontab -e)
* * * * * php /path/ke/nextmon-php/cron.php --quiet

# opsi: php cron.php --list | --job=poll,stock,backup | --force
```

```bat
:: Windows (Task Scheduler), sekali jalankan di CMD administrator
schtasks /Create /SC MINUTE /MO 1 /TN "NextMON cron" /TR "C:\xampp\php\php.exe C:\xampp\htdocs\nextmon\cron.php --quiet"
```

Hosting bersama tanpa crontab/CLI: pakai pemicu web `public/cron.php` dengan token rahasia (tampil di Monitor > Penjadwal,
bisa dibuat ulang). Daftarkan di cPanel Cron Jobs atau layanan seperti cron-job.org (tiap 5 menit):

```
curl -fsS "https://domain-anda/cron.php?token=TOKEN_ANDA" >/dev/null     # opsional: &job=poll,stock
```

### Yang dilakukan penjadwal
- **poll**: tiap router: latensi API, uptime, CPU, RAM, jumlah user hotspot aktif, ping internet dari router (default 1.1.1.1). Riwayat bergulir
  (+/- 7 hari) disimpan di penyimpanan NextMON; grafik dirender di server (SVG).
- **Alert** (lewat kanal Telegram/webhook di menu Notifikasi, riwayatnya selalu tersimpan di Monitor): router offline (setelah N gagal berturut-turut)
  dan pulih (setelah N sukses; debounce), CPU/RAM tinggi, stok voucher per profil di bawah minimum, user akan kedaluwarsa, backup gagal.
- **backup**: `/export` disimpan di `data/backups/<router>/` dan dirotasi (N terbaru); bila teks export tak dikirim API, berkas dibuat di router
  (`nextmon-auto-*.rsc`, juga dirotasi). Opsi `.backup` biner tetap berada di router (API tidak dapat mengunduhnya).
- Mode demo: tombol "Simulasikan gangguan" di Monitor untuk mencoba alert offline/pulih.

### Wizard setup router
Tiap langkah punya "Tampilkan perintah" (dry-run, tidak ada yang dikirim) dan "Terapkan" (butuh centang konfirmasi; perintah berisiko -
membatasi alamat API, reset password user, mengganti on-login, ganti zona waktu, ganti `html-directory` - butuh centang tambahan).
Setiap perintah yang diterapkan dicatat di log wizard (password tidak dicatat). Unggah template login hotspot tidak bisa lewat API:
wizard menyediakan zip `hotspot-nextmon.zip`, petunjuk WinBox/FTP/SCP, lalu memverifikasi unggahan dan (opsional) mengarahkan profil hotspot.

## Multi-akun (multi-tenant): ruang kerja, berbagi router, migrasi
Satu instalasi dipakai banyak pemilik. Rincian kontrak ada di `../docs/MULTITENANT.md`; ringkasnya:
- **Workspace** (`w_xxxxxxxx`, atau `main` untuk data lama) memegang router, voucher/penjualan, reseller & wallet, toko & pesanan, pengaturan, API key, backup, dan log.
  Koleksi `Store` otomatis diberi namespace `ws/<id>/…`; hanya `users`, `workspaces`, `shares`, `platform`, indeks, `login_attempts`, `rate_limits`,
  `sessions_meta`, `shop_rate`, `platform_audit` yang global. Tanpa workspace aktif, akses ke data per-workspace **melempar `NoWorkspaceException`** (gagal tertutup).
- **Peran**: `platform` (admin platform + pemilik workspace sendiri), `admin` (pemilik), `operator`, `reseller`, `viewer`. Capability baru `platform`.
  Workspace diambil dari sesi server pengguna; admin platform berpindah lewat `POST /platform/switch` (CSRF + audit, banner "Mode platform").
- **Berbagi router**: pemilik membagikan router ke workspace lain (`ro` = baca saja, `rw` = penuh). Penerima tidak pernah melihat host/user/password;
  mode `ro` ditegakkan terpusat (`ReadOnlyDriver`).
- **Suspend**: workspace `suspended` memblokir login, halaman publik, API key, dan cron untuk workspace itu.
- **Cron**: `php cron.php` menjalankan semua workspace aktif (masing-masing dalam `Workspace::run`); `--workspace=ID` membatasi. Token web: token platform (semua) atau token Monitor milik satu workspace.

Migrasi data lama (otomatis saat pertama dijalankan, idempoten, **cadangan dulu** ke `data/backup-tenant-<stamp>/`):
```
php bin/nextmon.php tenant:status     # apa yang belum dimigrasikan
php bin/nextmon.php tenant:migrate    # pindahkan data lama ke workspace "main" (admin tertua -> role platform)
php bin/nextmon.php tenant:list       # daftar workspace
```
Uji: `php tests/run.php Tenant` (unit, JSON + SQLite) dan `php tests/tenant_isolation_test.php [json|sqlite]` (serangan HTTP lintas-tenant).
