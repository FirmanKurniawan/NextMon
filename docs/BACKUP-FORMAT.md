# Format backup data aplikasi NextMON (v1)

Satu berkas JSON yang dibuat dan dibaca oleh **kedua edisi** (PHP `src/Backup.php`, Next `src/lib/appbackup.ts`). Cakupannya satu workspace (yang sedang aktif), hanya untuk **owner** (cap `admin`). Halaman: *Backup → Backup data NextMON / Pulihkan data NextMON*.

## Berkas
```json
{ "format": "nextmon-backup", "version": 1, "edition": "php|next", "created": "ISO-8601", "includes_secrets": false,
  "counts": { "routers": 2 }, "checksum": { "algo": "sha256", "value": "<hex>" }, "payload": "<JSON sebagai string>" }
```
- `payload` adalah data (di bawah) sebagai **string JSON**; `checksum.value` = SHA-256 hex dari byte UTF-8 string itu. Dengan begitu kedua edisi memverifikasi byte yang sama (tanpa kanonisasi). Tidak ada ZIP, jadi tidak ada risiko zip-slip; tidak ada nama berkas/path di dalam format.
- Tidak ada id/slug workspace di berkas. Batas ukuran 8 MB (di bawah 10 MB yang di-buffer pipeline request Next; `upload_max_filesize` PHP bisa lebih kecil). Ekspor yang lebih besar membuang baris log terlama (`"truncated": true`, peringatan saat restore).
- `version` > 1 ditolak ("buat oleh versi lebih baru"). Edisi asal hanya informasi.

## Payload
`{ "docs": { <nama>: nilai }, "logs": { <nama>: [baris, ...] }, "orders": [order, ...] }` (log: terlama dulu).

| Koleksi | Jenis | Isi | Catatan |
| --- | --- | --- | --- |
| `routers` | doc (list) | router milik sendiri (tanpa router bersama) | `pass` kosong, atau tetap terenkripsi `v1:` bila opsi rahasia dipilih. Maks 200. Batas router workspace dihormati. |
| `settings` | doc (map) | pengaturan + `templates` voucher | HTML templat dibangun ulang lewat sanitizer; `lang/timezone/currency/max_qty` divalidasi |
| `shop` | doc (map) | konfigurasi toko, kunci gateway | rahasia `v1:` dikosongkan kecuali opsi rahasia |
| `resellers`, `wallets` | doc (map) | konfigurasi reseller; saldo (bilangan bulat) | kunci `[A-Za-z0-9_.@-]{1,64}` |
| `wallet_ledger`, `reseller_batches` | log | buku besar dompet, batch voucher reseller | maks 50.000 baris |
| `orders` | list | pesanan toko | id `KL<yymmdd>-<6hex>[-<8hex ws>]`; bagian workspace id **diganti** dengan workspace aktif saat restore (PHP `main` tanpa sufiks) |

**Tidak pernah diekspor/diimpor:** `users`, sesi, `workspaces`, `shares`, `platform`, `apikeys` dan indeksnya (hash key), `monitor` (berisi `cron_token`), `audit.log`, cache. Nama koleksi lain di berkas diabaikan dan dilaporkan di pratinjau. Kunci bernama `workspace`, `ws`, `owner_ws`, ... dibuang di mana pun; kunci `__proto__/constructor/prototype` menolak seluruh berkas.

## Rahasia
String `v1:<base64>` (AES-256-GCM, format sama di kedua edisi) adalah rahasia. Default ekspor: dikosongkan. Dengan opsi "sertakan rahasia terenkripsi" ia ikut, tetapi saat restore harus **bisa didekripsi dengan kunci instalasi tujuan** (`secret.key`/`NEXTMON_SECRET` sama) atau akan dikosongkan (peringatan di pratinjau). Kata sandi router berupa teks biasa di berkas diabaikan. Router yang id-nya sama dan `pass` kosong di berkas mempertahankan kata sandi tersimpan (aturan yang sama dengan form router).

## Alur restore
1. **Periksa berkas** (unggah): ukuran, format, versi, checksum, skema per koleksi, batas. Tidak ada yang ditulis kecuali pratinjau tertunda (per workspace, terikat ke pengguna + token, kedaluwarsa 15 menit).
2. **Pratinjau**: tabel per koleksi (sekarang vs di berkas), peringatan, item yang diabaikan; pilih koleksi mana yang dipulihkan.
3. **Konfirmasi**: ketik `RESTORE` + token. Rate limit 12 percobaan/10 menit per pengguna; audit `backup.export|restore.preview|restore.rejected|restore|restore.failed`.
4. **Backup pengaman** otomatis (`pre-restore-*`, 10 terakhir, dapat diunduh dan dipulihkan lagi) lalu penerapan **atomik**: Next dalam satu transaksi SQLite; PHP menulis lalu mengembalikan snapshot bila ada kegagalan. Koleksi yang dipilih diganti seluruhnya (bukan digabung).

## Uji
- PHP: `tests/unit/BackupTest.php` (dua backend), fixture `tests/fixtures/backup-from-next.json`.
- Next: `tests/unit/appbackup.test.ts`, fixture `tests/fixtures/backup-from-php.json`.
- Fixture dibuat ulang: `NEXTMON_WRITE_FIXTURE=1 php tests/run.php Backup` dan `NM_WRITE_FIXTURE=1 npx vitest run tests/unit/appbackup.test.ts`, lalu salin silang.
