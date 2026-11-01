# ARCHITECTURE — NextMON

Dua implementasi (`nextmon-php`, `nextmon-next`) berbagi **model data, kontrak REST, dan format script RouterOS yang sama**
agar data & dokumentasi konsisten.

## 1. Model data bersama

Basis data: SQLite (default, WAL) / MySQL opsional. Semua `id` ULID/UUID teks, waktu UTC ISO-8601 (`*_at`).

| Tabel | Kolom utama |
|---|---|
| `routers` | id, name, host, port (8728/8729), use_ssl, ssl_verify, api_user, `api_pass_enc` (AES-256-GCM, format `v1:nonce:ct:tag`), hotspot_name, dns_name, currency, ros_version, timezone, last_seen_at, status, created_at |
| `users` | id, username (unik), email, `pass_hash` (argon2id / bcrypt cost 12), role_id, totp_secret_enc, totp_enabled, disabled, last_login_at, failed_logins, locked_until |
| `roles` | id, key (`admin`,`operator`,`agent`,`viewer`), permissions (JSON array string `voucher.create`, `sales.read`, ...) |
| `user_routers` | user_id, router_id (pembatasan akses router per user/agen) |
| `agents` | user_id, balance (integer rupiah, tanpa float), commission_pct, credit_limit |
| `agent_ledger` | id, agent_id, type (`topup`,`sale`,`refund`,`commission`), amount, balance_after, ref, created_at (append-only) |
| `vouchers` | id, router_id, batch_id, name, password, profile, price, validity, comment, status (`new`,`used`,`expired`,`deleted`), created_by, sold_by, sold_at, ros_id (cache `.id`), created_at |
| `voucher_batches` | id, router_id, profile, qty, prefix, mode, created_by, created_at |
| `profiles` | id, router_id, name, rate_limit, shared_users, validity, price, selling_price, expire_mode (`rem`,`ntf`,`remc`,`ntfc`,`0`), lock_mac, lock_server, parent_queue |
| `sales` | id, router_id, voucher_name, profile, price, address, mac, validity, sold_at, source (`router-script`,`pos`,`portal`,`agent`), agent_id, dedupe_key (UNIQUE: router+script-name) |
| `orders` | id, gateway, gateway_ref (UNIQUE), amount, status, voucher_id, payload_json, created_at (portal/payment) |
| `audit_log` | id, at, actor_id, actor_ip, router_id, action, target, before_json, after_json, result |
| `api_keys` | id, user_id, name, `key_hash` (SHA-256 dari token), prefix (8 char tampil), scopes, last_used_at, expires_at, revoked |
| `notifications` | id, channel (telegram/wa/webhook), config_enc, events (JSON), enabled |
| `metrics` | router_id, at, cpu, mem_free, temp, rx_bps, tx_bps, latency_ms (retensi 7 hari, downsample) |
| `settings` | key, value (brand, bahasa, template voucher) |

`sales` adalah **cache** dari `/system script` router (sumber kebenaran tetap di router agar kompatibel Mikhmon);
sinkronisasi menggunakan `dedupe_key`.

## 2. Lapisan akses RouterOS

```
UI/REST -> Service (otorisasi, audit) -> RouterClient (pool) -> RouterOS API (8728/8729) [atau REST v7]
```
- **RouterClient** per router: satu koneksi persisten (idle timeout 60 dtk), antrian perintah serial, timeout 8 dtk,
  retry 1x dengan backoff, circuit-breaker (router offline -> status `down`, hentikan poll 30 dtk).
- Antarmuka sama di kedua versi: `print(path, query, proplist)`, `add`, `set`, `remove`, `stream(path, args, onRow)`, `cancel(tag)`.
  Next: `node-routeros`. PHP: kelas API (RouterOS API PHP, mirip Mikhmon) dengan ekstensi streaming non-blocking terbatas.
- **Whitelist path**: service hanya memanggil path yang terdaftar (`ip/hotspot/*`, `system/resource`, ...). Tidak ada endpoint
  "kirim perintah bebas" kecuali permission `router.console` khusus Admin (default off).
- Normalisasi v6/v7 (health, date format, wifi path) di satu modul adapter (`ros-compat`).
- Argumen selalu melalui parameter API (`=k=v`), **bukan** konkatenasi script -> cegah injeksi. Nilai untuk script on-login
  (nama profil, harga) divalidasi regex `^[A-Za-z0-9 _.\-]{1,64}$` / angka.
- Batch: `add` voucher dalam chunk 50 dengan jeda kecil; laporkan progres.

## 3. Model keamanan

- **Autentikasi**: sesi cookie `HttpOnly; Secure; SameSite=Lax`, ID acak 256 bit, rotasi saat login; TOTP 2FA opsional (wajib untuk Admin di rilis berikut); rate-limit login (5/menit/IP+user, lockout bertahap).
- **Otorisasi**: RBAC berbasis permission (tabel `roles`), dicek di service layer, bukan hanya UI. Agen hanya melihat router/profil yang diizinkan dan voucher miliknya.
- **Rahasia**: password router AES-256-GCM, kunci master dari env `NEXTMON_SECRET` (32 byte, base64) atau file di luar webroot; tak pernah dikirim ke klien/log. Mikhmon menyimpan di config file; NextMON tidak. Rotasi kunci: perintah `rekey`.
- **Web**: CSRF token (double-submit/sinkron), CSP ketat (`default-src 'self'`; nonce skrip), `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS bila HTTPS, validasi input skema (zod / validator PHP), output di-escape, query DB berparameter.
- **API key**: token `kl_<prefix>_<secret>`, hanya hash disimpan, scope per key, bisa dicabut, rate-limit per key.
- **Webhook payment**: verifikasi signature HMAC, idempoten via `orders.gateway_ref`, transaksi DB atomik untuk saldo.
- **Router**: user API least privilege + pembatasan `address` (lihat `07-api-user-least-privilege.rsc`); gunakan API-SSL jika NextMON tidak satu LAN.
- **Audit**: setiap aksi tulis (voucher, profil, kick, firewall, backup, login) dicatat; log tidak dapat diubah dari UI.
- **Ancaman utama**: pencurian DB (mitigasi enkripsi kolom), XSS lewat nama voucher/komentar (escape), SSRF pada URL webhook (blok IP privat), brute force (rate-limit).

## 4. Realtime

- **Next.js**: Server-Sent Events `/api/stream/:routerId?topics=traffic,resource,active`; satu poller per router dibagikan ke semua klien (fan-out), berhenti ketika klien 0.
- **PHP** (tanpa proses panjang): polling AJAX `fetch` tiap 2-5 dtk ke `/api/live.php`; hasil di-cache 1 dtk (APCu/file) agar banyak tab tidak membebani router. SSE opsional bila server mengizinkan.
- Sumber data: `monitor-traffic =once=`, `system/resource`, `system/health`, `ip/hotspot/active/print count-only`.
- Latensi router & status offline: heartbeat 30 dtk -> tabel `metrics`; notifikasi bila 3x gagal (bergantian dengan netwatch di router agar ada dua sudut pandang).
- Klien menyimpan buffer 120 titik untuk sparkline; `prefers-reduced-motion` mematikan animasi.

## 5. Alur penting

1. **Generate voucher**: validasi -> audit -> chunked `user/add` -> simpan `vouchers` -> halaman cetak/QR.
2. **Penjualan**: on-login script di router menulis `/system script` (format Mikhmon) -> job sinkron NextMON (poll 60 dtk atau tombol) membaca skrip baru (`?comment=mikhmon`) -> `sales` (dedupe) -> dashboard.
3. **Expire**: mode `rem`/`remc` hapus user; `ntf`/`ntfc` biarkan, tandai; scheduler router `nextmon-expire` menjalankan pembersihan.
4. **Notifikasi**: event (router down, stok rendah, pembayaran) -> antrian -> Telegram/WA/webhook, retry eksponensial.

## 6. Struktur & tes
Layer: `routes/controllers` -> `services` -> `repositories` + `ros`. Tes unit (service, ros-compat dengan fixture respons v6/v7),
tes integrasi dengan RouterOS CHR (Docker/VM) untuk jalur `.rsc`, e2e Playwright.
