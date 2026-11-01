# Multi-akun (multi-tenant) NextMON — spesifikasi

Tujuan: satu instalasi web dipakai banyak pemilik. Setiap pemilik punya ruang kerja (**workspace**) sendiri berisi router, voucher/penjualan,
reseller & wallet, pesanan toko, pengaturan, notifikasi, API key, backup, dan log. Pemilik A tidak boleh melihat/mengubah data pemilik B,
kecuali router yang sengaja dibagikan. Dipakai sebagai layanan cloud gratis: **akun dibuat oleh admin platform**, lalu pemilik menambah router sendiri.

## Istilah & peran
- **Workspace** `w_xxxxxxxx` (id acak), punya `slug` unik (huruf kecil/angka/-) untuk URL publik (`/shop?w=slug`), `name`, `limits`, `status` (active/suspended).
- **Platform admin** (`role = platform`): pengelola layanan. Melihat semua workspace, membuat/menghapus akun, menetapkan batas, bisa "masuk" ke workspace mana pun (ditandai banner + tercatat di audit).
- **Owner** (`role = admin` di dalam workspace): admin penuh *hanya di workspacenya*: router, staf, pengaturan, toko.
- **Staf**: `operator`, `reseller`, `viewer` (sama seperti sekarang) — terikat ke satu workspace, dibuat oleh owner.
- Capability baru `platform` (hanya platform admin). Capability lama (`view`, `sell`, `write`, `admin`) tetap, tetapi **selalu dievaluasi di dalam workspace aktif**.
- User punya `workspace` (id). Platform admin punya workspace pribadi juga (default `main`) dan dapat berpindah.

## Data
Global (tidak per-workspace): `users` (+ field `workspace`), `login_attempts`, `rate_limits`, `sessions_meta`, `workspaces`, `shares`, indeks global `apikey_index`
(hash key → workspace), `session_index` (nama sesi status → workspace/router), `platform` (pengaturan platform: signup, batas default, kebijakan password).
Per-workspace (diawali namespace otomatis oleh Store): `routers`, `settings`, `shop`, `wallets`, `resellers`, `apikeys`, `scheduler`, `monitor*`, `orders/`, `backups/`,
`cache` router, semua log (`audit.log`, `notify.log`, `alerts.log`, `wizard.log`), preset/template voucher (sudah di `settings`).
Data lama (single-tenant) dimigrasikan otomatis ke workspace `main` (cadangan dulu, idempoten).

## Lapisan inti (kontrak yang dipakai semua modul)
```php
Workspace::id(): string                      // workspace aktif untuk request ini (dari user login, atau dari konteks eksplisit)
Workspace::set(string $id): void             // dipakai Auth/App setelah login & saat platform admin berpindah
Workspace::run(string $id, callable $fn)     // jalankan $fn di konteks workspace lain lalu kembalikan (cron, webhook, halaman publik)
Workspace::get(string $id): ?array           // record workspace
Workspace::all(): array
Workspace::create(array $data): array        // name, slug, owner username/password, limits
Workspace::limits(string $id): array         // ['routers'=>n,'staff'=>n,...] gabungan default platform + override
Workspace::bySlug(string $slug): ?array
Store::read/write/update/append/rows/... .   // API tidak berubah; nama koleksi per-workspace otomatis diberi namespace "ws/<id>/<nama>"
Store::global(string $name)                  // akses eksplisit ke koleksi global (users, shares, workspaces, indeks)
Share::for(string $routerId): ?array         // aturan berbagi router; App::routers() mengembalikan router milik sendiri + yang dibagikan (flag shared, mode ro|rw)
```
Aturan emas: **tidak ada kode yang membaca/menulis berkas data langsung**; semua lewat `Store`. Direktori per-workspace (orders, backups, cache) lewat `Workspace::dir('orders')`.
Default aman: bila tidak ada workspace aktif, akses ke koleksi per-workspace **melempar exception**, bukan jatuh ke data global.

## Fitur
1. Akun & workspace: halaman platform (`/platform/accounts`): buat/ubah/suspend/hapus workspace + owner, atur batas (router, staf, voucher/hari, ukuran log), reset password, impersonate (masuk sebagai).
2. Staf: owner mengelola staf di `/settings` (tidak bisa membuat staf di luar batas, tidak bisa membuat owner/platform).
3. Onboarding: akun baru kosong → diarahkan ke "Tambah router"; tombol "Coba mode demo" (router demo per-workspace).
4. Berbagi router: owner membagikan router ke workspace/user lain (`ro` = baca saja, `rw` = penuh, dapat dicabut). Router bersama tampil bertanda di pemilih router; password router tidak pernah terlihat penerima.
5. Publik: `/shop?w=<slug>`, `/status?session=<nama>&w=<slug>`, `/pay/callback` (order id membawa workspace), API key global-index → workspace. Rate limit tetap global.
6. Cron/monitor/scheduler: iterasi semua workspace aktif, masing-masing dalam `Workspace::run`.
7. Audit: setiap entri mencatat `workspace` dan `actor`; tindakan platform admin di workspace lain ditandai.
8. Keamanan: ID workspace dari sesi server, **tidak pernah dari input klien** (kecuali platform admin saat berpindah, dengan CSRF + audit); semua ID objek (router, order, voucher batch, wallet, api key) divalidasi milik workspace aktif; `Cache`/`CachedDriver` kunci menyertakan workspace.

## Tes wajib (tests/tenant_isolation_test.php)
Dua owner A dan B + staf masing-masing + platform admin: setiap rute GET/POST dicek (A tidak bisa membaca/mengubah objek B lewat id yang ditebak),
router yang dibagikan (ro/rw) berperilaku benar, batas dipatuhi, suspend memblokir login & publik, cron tidak mencampur data, migrasi data lama, tidak ada berkas data yang dibaca di luar `Store`.

---
# Kontrak implementasi (core, final) — sumber kebenaran bila berbeda dengan teks di atas

## Workspace (`nextmon-php/src/Workspace.php`)
```php
Workspace::ID_RE                                 // /^(main|w_[a-f0-9]{8})$/ ; `main` = workspace tempat data lama dimigrasikan
Workspace::idOrNull(): ?string                   Workspace::id(): string  // id() melempar NoWorkspaceException bila tak ada
Workspace::set(string $id): void                 Workspace::clear(): void  // set() hanya memvalidasi format
Workspace::run(string $id, callable $fn)         // konteks sementara, dipulihkan walau $fn melempar
Workspace::all(): array   get($id): ?array   bySlug($slug): ?array   resolveRef($slugOrId): ?array
Workspace::status($id): ?string  // 'active'|'suspended'|null ; `main` tanpa record = active
Workspace::exists($id): bool   isActive($id): bool   activeIds(): array
Workspace::create(array $d): array   // name, [slug], owner, password, [owner_name], [limits], [status]; InvalidArgumentException bila salah
Workspace::update($id, array $patch): ?array  // name, slug, status, limits
Workspace::setStatus($id, 'active'|'suspended'): ?array   Workspace::delete($id): bool  // tak bisa hapus main / ws yang punya admin platform
Workspace::ensureMain(?string $ownerId = null, string $name = 'Main'): array
Workspace::platform(): array / savePlatform(array $patch) / platformCronToken(): string   // doc global `platform`
Workspace::limits(?string $id = null): array  // keys: routers, staff, vouchers_per_day, log_rows ; 0 = tak terbatas
Workspace::allows(string $what, int $current, ?string $id = null): bool   // dipakai RoutersController (routers) & SettingsController (staff)
Workspace::dir(string $sub = ''): string  dirFor($id, $sub)   // data/ws/<id>/<sub>  (orders, backups, cache, demo)
Workspace::indexKey($hash,[$ws]) unindexKey($hash) wsByKeyHash($hash) reindexKeys([$ws])        // apikey_index
Workspace::reindexSessions([$ws]) bySession($session, $slugOrId = ''): ?array ['ws','rid']          // session_index
Workspace::resolvePublic(string $path, ?string $rawBody): array [?wsId, ?'unknown'|'suspended']   // dipanggil App::run untuk /shop /shop/order /pay/callback /status /status.json
Workspace::slug(): string                        // slug workspace aktif (untuk tautan publik)
Workspace::platformLog($action, $detail)   // log global `platform_audit`
```
- Kolom koleksi global tambahan di `Store::GLOBAL_DOCS`: `shop_rate` (rate-limit toko, tetap global) dan `platform_audit` (log tindakan platform + login gagal untuk nama tak dikenal).
- `Store::global($name): StoreGlobal` (`read/write/update/append/rows/count/prune/has/delete`); `Store::names()` = dokumen workspace aktif; `Store::allNames()` = kunci mentah; `Store::purgeWorkspace($id)`.
- `Store::settings()/setting()` **tidak** melempar tanpa workspace: mengembalikan default + `platform['settings']` (halaman login/setup). Penulisan tetap melempar.
- Kunci backend: `ws/<id>/<nama>` (SQLite: kunci `docs.name`/`logs.channel`; JSON: `data/ws/<id>/<nama>.json` / log).

## Auth / App
- `Auth::ROLES` = peran yang dapat diberikan pemilik (`admin|operator|reseller|viewer`); `Auth::ALL_ROLES` menambah `platform`. `platform` ⊇ semua capability + `platform`.
- `Auth::create($u,$pw,$role,$name='',?$workspace=null): array` (level rendah: menerima `platform`; UI harus memvalidasi terhadap `ROLES`).
  `Auth::users()` = pengguna workspace aktif (semua bila tak ada workspace aktif), `Auth::allUsers()` = global, `Auth::inWorkspace($id)`, `Auth::find()` global (username unik se-platform).
  `Auth::createFirstAdmin()` membuat admin **platform** + workspace `main` + router demo.
- Workspace request = workspace pengguna dari sesi server (`Auth::user()` memanggil `Workspace::set`). Admin platform: `$_SESSION['ws_switch']` (hanya di-set oleh `WorkspaceSwitchController` setelah CSRF), divalidasi tiap request. `App::$impersonating` true bila beda dari rumah.
  Workspace suspended/dihapus = sesi pengguna non-platform mati; login ditolak setelah password benar (pesan "ditangguhkan"); admin platform dikecualikan.
- `POST /platform/switch` (`workspace` = id|slug|`home`), cap `platform`, `src/routes.d/tenant.php`; banner di `layout.php` (blok `MULTITENANT-BANNER`).
- Audit: tiap baris punya `workspace`, `actor` (+ `user` lama) dan `via=platform` saat impersonate. Tanpa workspace aktif -> `platform_audit`.
- `App::ownRouters()` (milik sendiri, berisi kredensial; dipakai cron/Monitor) vs `App::routers()` (milik sendiri + dibagikan; entri dibagikan: `shared=true, mode ro|rw, owner_ws, owner_name`, **tanpa** host/user/pass). `App::routerCfg()`, `App::isShared($id)`, `App::routerOwner($id)`, `App::seedDemoRouter()` (tombol "coba demo"), `App::applyLocale()`.
  `App::currentRouterId()` = `''` bila tak ada router. Kredensial router bersama diselesaikan di `App::driver()/driverFor()`; mode `ro` -> `ReadOnlyDriver` (semua write melempar `RouterOSException`).
- `Share` (`src/Share.php`): `for($routerId)` (share yang memberi workspace aktif akses), `incoming()`, `outgoing($routerId='')`, `grant($routerId, $toSlugOrId, 'ro'|'rw')`, `revoke($shareId)` (pemilik atau penerima), `dropRouter($routerId)`. Router demo tak bisa dibagikan.
- Cache: semua kunci diberi prefix workspace; kunci router `rt:<ws pemilik>:<router>` / `rd:…` memakai workspace **pemilik router** (penerima share dan pemilik berbagi entri + invalidasi). `CachedDriver::nsFor($rid, ?$ownerWs)`, `CachedDriver::flush($rid, ?$ownerWs)`.
- Halaman publik: satu-satunya pemilih dari klien adalah **slug** (`?w=slug`); id/nama/header/cookie tidak pernah dibaca. `/shop` dan `POST /shop/order` memakai `?w=slug` (tanpa `w` = `main`); parameter `id` diabaikan di `/shop`. `GET /shop/order?id=` membawa workspace di id pesanan (`KL<yymmdd>-<6hex>` untuk main/lama, `KL<yymmdd>-<6hex>-<8hex workspace>` untuk lainnya; `Orders::workspaceOf($teks)`) lalu **token** diperiksa; token salah = halaman 404 netral tanpa branding (workspace dikosongkan). `/pay/callback`: `?w=slug` (URL webhook yang kita buat), cadangan: workspace di id pesanan dalam payload; keaslian = tanda tangan gateway. `/status`: indeks sesi (+ `?w=slug` bila nama sesi ganda). Helper tautan: `Shop::wQuery()`, `Shop::homePath()`.
- Rute platform (cap `platform`; `src/routes.d/tenant.php`, `PlatformController`, `views/platform_accounts.php`, menu "Accounts"): `GET /platform/accounts`, `POST /platform/accounts/{create,status,limits,reset,delete}`, `POST /platform/switch`. Parameter: create `name, slug?, owner, password, routers?, staff?, vouchers_per_day?, log_rows?`; status `id, status=active|suspended`; limits `id, routers, staff, vouchers_per_day, log_rows` (kosong = default platform); reset `id, password` (password pemilik); delete `id`; switch `workspace=<id|slug|home>`.
- Rute berbagi router (cap `admin`): `POST /routers/share` (`router`=id router milik sendiri, `to`=slug workspace tujuan, `mode`=`ro|rw`; berbagi ulang mengganti mode) dan `POST /routers/share/revoke` (`share`=id share, ATAU `router` + `to` untuk pemilik, ATAU `router` saja untuk penerima yang melepas). Router bersama tidak bisa diubah/dihapus penerima (`/routers/save`, `/routers/delete` menolak). `POST /routers/select` menerima `router` atau `id`. Sesi UI `/json/*?router=ID` boleh memilih router lain **milik workspace itu atau dibagikan padanya**; id lain = 404.
- Berkas cache turunan per-workspace: `data/ws/<id>/cache/c-*.dat` (kunci berprefix workspace); kunci tanpa workspace di `data/cache/`.
- Cron: `Scheduler::run($only, $force, $source, ?array $workspaces = null)` mengiterasi workspace aktif (hasil baris punya `ws`); `Scheduler::tokenScope($token)` -> `['*']` (token platform) | `[id]` | `null`; `php cron.php --workspace=ID`.
- `Crypto::rotate()` mengenkripsi ulang rahasia semua workspace dengan satu kunci platform.

## Migrasi (`src/TenantMigration.php`)
Otomatis pada `Store::backend()` pertama bila `data/tenant.migrated` belum ada (matikan dengan env `NEXTMON_TENANT_AUTO=0`); CLI `tenant:status|migrate|list`. Urutan: cadangan `data/backup-tenant-<stamp>/` -> pindahkan koleksi/log tanpa namespace ke `ws/main/` -> pindahkan `orders/`, `backups/`, `demo-*.json` ke `data/ws/main/{orders,backups,demo}` -> pengguna `workspace=main`, admin tertua jadi `platform` + pemilik `main` (limit tak terbatas) -> bangun ulang indeks key & sesi -> tulis marker. Idempoten dan aman diinterupsi (marker terakhir).

## Berkas non-dokumen yang tetap global (disengaja)
`secret.key` (satu kunci platform), `cron.lock`, `sessions/`, `cache/routes.php` & `cache/lang-*.ser` (tanpa data tenant), `cache/rc-*.json` (penanda soket/breaker per perangkat+kredensial), `cache/c-*.dat` (kunci sudah berprefix workspace).
Semua yang lain per-workspace melalui `Workspace::dir()`.
