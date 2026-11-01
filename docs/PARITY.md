# Paritas PHP vs Next.js

Audit sistematis edisi PHP (`nextmon-php`) terhadap edisi Next.js (`nextmon-next`). Metode: halaman yang sama diambil dari kedua server (mode demo, akun platform/admin/operator/reseller/viewer/akun kosong), lalu dibandingkan teks utama, tautan, field form, atribut `data-*`, menu per peran, status HTTP per peran, bentuk respons `/api/v1`, `manifest`/`sw.js`, dan kunci `t()`.

Status: **sama** = sudah identik saat audit; **diperbaiki** = ada selisih, sudah disamakan pada audit ini; **beda** = selisih tersisa (alasan di kolom catatan); **Next lebih** / **PHP lebih** = fitur satu sisi (celah terbalik).

## Matriks

| Fitur | PHP | Next | Status | Catatan |
|---|---|---|---|---|
| Dashboard, Users, Profiles, Vouchers, Reports, POS, Active, Hosts, Queues, Firewall, Tools, Monitor, PPPoE, DHCP, ARP, Walled garden, Wizard, Notifications, Audit, Settings, Routers, Backup, Import, Shop | ada | ada | sama | teks, tautan, field form identik |
| Halaman Hosts (filter, pilih massal, hapus massal, kolom) | ada | ada | diperbaiki | Next ditulis ulang mengikuti `views/hosts.php`; aksi `hotspot/hosts/remove` ditambah |
| Kartu "App log" dashboard + tautan "View all" (admin) | ada | ada | diperbaiki | |
| Onboarding akun kosong (tanpa router) di semua halaman | kartu sambutan | kartu sambutan | diperbaiki | Next: `NoRouter.tsx` (Onboarding) menggantikan teks kosong; PHP: `routerError` dan dashboard menampilkan kartu sambutan, bukan 502 |
| Menu: urutan item Jaringan/Sistem | ada | ada | diperbaiki | urutan Next disamakan dengan PHP (`nav.d`) |
| Menu: "My wallet" hanya untuk reseller | ada | ada | diperbaiki | `NavItem.roles` |
| Menu: Security terlihat di menu | ada | ada | diperbaiki | item nav `security` ditambah |
| Tab bawah (mobile): Active menggantikan Vouchers bila tak bisa jual | ada | ada | diperbaiki | `tabFallback` |
| Topbar: lonceng notifikasi (admin), "My account", "Voucher status page" | ada | ada | diperbaiki | |
| Banner impersonasi platform | ada | ada | diperbaiki | teks, kelas, role disamakan |
| Ganti workspace dari shell (id, slug, `home`, kosong) | ada | ada | diperbaiki | `switchWorkspace()`: reset router, audit di log platform dan workspace target, error jadi flash |
| Gating peran: 403 untuk halaman terlarang | HTTP 403 | HTTP 403 | diperbaiki | Next dulu 200 dengan kartu Forbidden; sekarang `forbidden()` + `forbidden.tsx` |
| Halaman error (500) | ada | ada | diperbaiki | `(app)/error.tsx` |
| Halaman `/offline` (PWA) | ada | ada | diperbaiki | |
| `manifest.webmanifest` (lang, shortcuts) | ada | ada | diperbaiki | |
| `sw.js` | ada | ada | sama | byte identik |
| Rewrite unduhan: `/reports/export`, `/orders/export`, `/import/{template,export,errors}`, `/wizard/template.zip`, `/backup/download` | ada | ada | diperbaiki | |
| JSON sesi `/json/*` untuk JS bersama (dashboard, status, traffic, interfaces, hosts, logs, dll.) | ada | ada | sama | |
| JSON sesi `/json/users, profiles, active, sales, vouchers, kick` | ada | ada | diperbaiki | fitur baru `restapi/` (baca: view; tulis: write; `?router=` divalidasi) |
| `/api/v1/*` (kunci API): bentuk respons | ada | ada | sama | dibandingkan per panggilan |
| CSP: style inline tanpa melemahkan CSP | n/a | ada | diperbaiki | dev: `style-src-elem 'self' 'unsafe-inline'` (tanpa nonce); produksi tetap nonce saja |
| Hidrasi nonce `theme.js` | n/a | ada | diperbaiki | `suppressHydrationWarning` pada script (browser menyembunyikan atribut nonce) |
| i18n: kunci `t()` PHP ada di Next | 1359 kunci | 1359 kunci | diperbaiki | `id.json` dibangkitkan ulang dari PHP (`port-lang.php`); terjemahan Next yang menimpa dihapus agar teks PHP menang; tes `i18n-coverage` |
| Default form: charset voucher "safe"; role user baru "operator"; nama hotspot demo; default telegram/webhook/templates | ada | ada | diperbaiki | sebagian di sisi PHP (role), sebagian di Next |
| CLI: `doctor`, `tenant:list`, `tenant:status`, `crypto:rotate`/`rekey`, `storage:status`, `storage:vacuum`, `cache:clear`, `cron` | ada | ada | diperbaiki | `scripts/cli.mts` ditulis ulang; `cache:clear` hanya pesan (tak ada cache berkas di Next) |
| CLI: `storage:migrate`, `tenant:migrate` | ada | tidak ada | beda | Next tidak punya penyimpanan JSON warisan untuk dimigrasi (SQLite sejak awal) |
| Cron | `cron.php`, `public/cron.php`, `bin/nextmon.php cron` | `/api/public/cron`, `cli cron` | beda | endpoint berbeda nama; fungsi sama (job, `--workspace`, `--force`) |
| Aset front-end | `/assets/dist` ter-hash | disalin `sync-assets` | beda | mekanisme build berbeda; isi CSS/JS sama |
| Flash "Admin account created. Welcome!" setelah setup | ada | tidak ada | beda | kecil; Next langsung masuk ke dashboard |
| `orders/view` tanpa id valid | redirect | pesan inline | beda | kecil, perilaku UX berbeda |
| Router: opsi `verify_tls` | ada (controller) + UI | ada | diperbaiki (PHP) | celah terbalik: UI PHP tidak punya checkbox; ditambahkan |
| Router: berbagi router ke workspace lain (dialog, tabel "Shared with other accounts", Revoke, Stop using) | controller saja | ada | diperbaiki (PHP) | celah terbalik: view PHP dilengkapi |
| Halaman Traffic | tidak ada | ada | Next lebih | tidak ditambah ke PHP (butuh JS/grafik baru) |
| Coba mode demo (akun kosong) | tidak ada | ada | Next lebih | |
| Pemilih workspace di topbar | tidak ada | ada | Next lebih | |
| `/api/health`, `/api/diag` | tidak ada | ada | Next lebih | |
| Audit API memakai pengguna `api:<nama>` | tidak ada | ada | Next lebih | |
| Pemakaian akun platform (kolom "Pemakaian"), limit voucher/hari dan `log_rows` | ada | ada | sama | dikerjakan setelah audit; diuji di kedua edisi |
| Backup/restore data aplikasi dari UI (`type=appdata`, kotak secrets, input berkas restore) | ada | ada | sama | dikerjakan setelah audit; diuji di kedua edisi |
| Penjualan reseller via shop | ada | ada | sama | dikerjakan setelah audit; diuji di kedua edisi |
| CSS tambahan: `mod-network.css` (tools/backup/queues/firewall) dan `mod-shop.css` (pengaturan shop) | tidak dimuat | dimuat | beda | tidak terlihat di UI; dibiarkan |

## Celah terbalik (PHP kekurangan)

- Diperbaiki di PHP (kecil, aman): checkbox `verify_tls`, UI berbagi router (dialog, tabel keluar, Revoke, "Stop using"), kartu sambutan akun kosong, default role operator pada dialog tambah user.
- Tidak ditambah ke PHP: halaman Traffic, mode demo sekali klik, pemilih workspace topbar, `/api/health`, `/api/diag`, audit pengguna `api:<nama>`.

## Verifikasi

Lihat laporan akhir tugas (perintah yang dijalankan: typecheck, lint, vitest termasuk `parity.test.ts` dan `i18n-coverage.test.ts`; PHP: `php -l`, `php tests/run.php`). Halaman diperiksa tanpa overflow horizontal pada lebar 375px (users, profiles, vouchers, reports, pos, settings, dashboard).
