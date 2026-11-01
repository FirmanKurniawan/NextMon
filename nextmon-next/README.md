# NextMON — edisi Next.js

Pengelola hotspot MikroTik multi-tenant (pesaing Mikhmon). Edisi ini adalah **pondasi**: shell UI, auth, multi-tenant, lapisan RouterOS, dan dashboard dengan trafik langsung. Fitur lain ditambahkan sebagai modul di `src/features/` (lihat [DEVELOPING.md](DEVELOPING.md)).

Tampilan memakai design system yang sama dengan edisi PHP (`../nextmon-php/public`), disalin apa adanya oleh `npm run sync-assets` — jangan di-restyle.

## Kebutuhan

- Node.js 22.13+ (disarankan 24; memakai `node:sqlite` bawaan, tanpa dependensi native)
- Dependensi runtime minimal: `next`, `react`, `react-dom`, `zod`

## Menjalankan

```bash
cd nextmon-next
npm install
npm run dev                     # http://localhost:3000  (mode dev)
```

Produksi (output `standalone`, dipakai peluncur NextMON Server):

```bash
npm run build
NEXTMON_DATA=/var/lib/nextmon NEXTMON_BASE_URL=https://nextmon.example.com PORT=3000 HOSTNAME=127.0.0.1 \
  node .next/standalone/server.js
```

Mode demo (router simulasi, tanpa MikroTik): `NEXTMON_DEMO=1`. Saat pertama dibuka, `/setup` membuat akun admin platform (tidak ada kredensial bawaan).

## Variabel lingkungan

| Variabel | Fungsi |
| --- | --- |
| `NEXTMON_DATA` | Folder data: SQLite, `secret.key` (0600), file per-workspace. Default `./data` |
| `NEXTMON_DEMO` | `1` = semua router memakai simulasi |
| `NEXTMON_SETUP_TOKEN` | Bila diisi, `/setup?token=...` wajib cocok untuk membuat admin pertama |
| `NEXTMON_BASE_URL` | Origin publik kanonik. **Wajib di produksi**: Host dan Origin divalidasi terhadapnya. Tanpa ini hanya format Host yang diperiksa |
| `NEXTMON_ALLOWED_HOSTS` | Host tambahan yang diizinkan (jika `BASE_URL` tidak diset) |
| `NEXTMON_TRUSTED_PROXIES` | IP/CIDR proxy yang `X-Forwarded-*`-nya dipercaya (loopback selalu) |
| `NEXTMON_SESSION_IDLE_MIN` | Batas idle sesi, menit (default 480; 0 = mati) |
| `NEXTMON_ALLOW_PRIVATE_WEBHOOK` | `1` = penjaga SSRF mengizinkan target privat |
| `NEXTMON_SECRET` | Kunci base64 32 byte (alternatif `secret.key`; menonaktifkan rotasi kunci) |
| `PORT`, `HOSTNAME` | Alamat dengar server |

## Arsitektur singkat

- **Multi-tenant**: workspace → owner/staff; admin platform dapat "masuk" ke workspace (banner impersonating). Workspace aktif disimpan di **sesi server**, tidak pernah dari klien. `Store` (SQLite WAL) memakai `AsyncLocalStorage` dan **gagal tertutup** tanpa workspace; hanya koleksi di allow-list global yang lintas tenant. Router bisa dibagikan antar-workspace (`ro`/`rw`); `ro` memakai `ReadOnlyDriver`.
- **RouterOS** (`src/lib/routeros.ts`): klien API penuh (tag, pipelining, stream + `/cancel`, timeout, batas ukuran, reconnect, pool dengan keepalive, circuit breaker). `driver.ts`: Real, Demo, ReadOnly, Cached.
- **Trafik langsung**: SSE `/api/stream/traffic?interface=`; satu stream `monitor-traffic` per router+interface dibagi ke semua browser, ditutup 3 detik setelah pelanggan terakhir pergi.
- **Keamanan**: scrypt, sesi sisi server (hash token), cookie `__Host-` di HTTPS, CSRF per sesi, rate limit login (per user+IP, per IP, per username + kunci), CSP bernonce, header keamanan, validasi Host/Origin, IP klien hanya dari socket kecuali proxy tepercaya, penjaga SSRF, AES-256-GCM untuk password router (format `v1:` kompatibel edisi PHP), sanitizer HTML template.
- **i18n**: `id` (default) dan `en`; 1311 kunci diporting dari edisi PHP, fitur menambah kamus sendiri.

## Perintah

```
npm run typecheck | lint | test | build
npm run sync-assets
npm run cli -- rekey      # rotasi kunci enkripsi (hentikan server)
npm run cli -- doctor
```

## Pengujian

`npm test` (vitest) mencakup: klien RouterOS terhadap server RouterOS palsu (tag, fragmentasi, stream/cancel, reconnect, circuit breaker, login lama), Store, kripto, auth + rate limit, isolasi tenant, net/SSRF, generator script/voucher/penjualan, sanitizer, i18n, registry fitur, driver, dan TrafficHub (N pelanggan → 1 upstream).

**Belum diuji**: terhadap perangkat MikroTik sungguhan, TLS API (termasuk cipher ADH), dan di Linux/macOS.

## Batasan saat ini

Belum ada UI untuk: CRUD Router, akun platform/workspace, staff, berbagi router, voucher/penjualan/toko/pembayaran. Pustaka (`src/lib`) sudah siap; halaman dibangun sebagai fitur terpisah.
