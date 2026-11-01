# PLAN — Proyek "NEXTMON" (pesaing Mikhmon)

> Nama produk: **NextMON** (nama kerja awal: Kilat). Alternatif lain yang pernah diusulkan: Hotglass, Wifora, Tikspot, Hotspotku, MikroSpot, Wavo, Orbyt.
> Alternatif nama: `Hotglass`, `Wifora`, `NetNova`, `Voucherly`, `Zyrix`, `Mikara`, `NextMONnet`, `Hotspotr`.
> Ganti nama cukup di satu tempat: `config/brand` (PHP) / `src/lib/brand.ts` (Next.js).

## 1. Hasil riset Mikhmon (laksa19.github.io)
Mikhmon = web app (PHP + RouterOS API, tanpa RADIUS) untuk mengelola Hotspot MikroTik. v3 stabil, v4 beta.
Fitur inti Mikhmon: multi-router session, dashboard (resource, jumlah user aktif, income harian/bulanan),
user hotspot (CRUD, generate voucher batch), user profile + on-login script (expire, harga, validity, lock MAC),
user active / hosts / IP binding / cookies, laporan penjualan (disimpan di `/system script`), template voucher
cetak, live report, scheduler cleanup expired, editor halaman login hotspot, Idle timeout, multi bahasa, tema.
Kelemahan: UI jadul, PHP prosedural, tanpa role/multi-user, tanpa API/webhook/notifikasi, tanpa grafik live,
tanpa PWA, tanpa audit log, tanpa self-service pembelian, laporan terbatas, keamanan lemah (password router
plain/obfuscated di file config).

## 2. Fitur NextMON
### Paritas Mikhmon
Multi-router · Dashboard · Hotspot users/profiles/active/hosts/IP-binding/cookies · Generate voucher (batch,
prefix, panjang, karakter, mode user=pass / user+pass) · On-login script generator (rem/ntf/remc/ntfc,
lock MAC/server, catat penjualan) · Laporan penjualan · Template voucher + cetak · Scheduler expiry · Logs.

### Fitur BARU (belum ada di Mikhmon, tapi jalan di MikroTik via RouterOS API)
1. **Grafik live** traffic interface (`/interface/monitor-traffic`), CPU/RAM/temperature/voltage (`/system/health`).
2. **Top talkers & Torch** (`/tool/torch`), **Ping/Traceroute/Bandwidth-test** dari UI.
3. **Voucher QR code** (login satu-scan, link `http://hotspot/login?username=..&password=..`) + PDF/PNG export.
4. **Role-based access**: Admin · Operator · Reseller/Agen (saldo & komisi) · Viewer. Audit log. (2FA TOTP dibatalkan: terlalu ribet.)
5. **Reseller/Agent & POS**: kasir jual voucher cepat, saldo agen, struk thermal 58/80mm.
6. **Notifikasi** Telegram / WhatsApp gateway / webhook: voucher habis, router offline, stok voucher rendah, login mencurigakan.
7. **Router health monitor**: netwatch, uptime, alert offline, riwayat latensi.
8. **Bandwidth & FUP**: simple queue / queue tree manager, limit per profile, quota (limit-bytes-total), shared-users, ubah rate-limit user aktif on-the-fly, kick user.
9. **Auto-backup**: export config `.rsc` & `.backup` terjadwal (`/export`, `/system/backup`), download dari UI.
10. **Walled garden, DHCP leases, ARP, firewall address-list (block/allow), blacklist MAC** manager.
11. **PPPoE secrets/active & Static/Simple queue** manager (ISP lebih lengkap).
12. **Scheduler & Script manager** (lihat/tambah `/system scheduler`, `/system script`) + library script siap pakai (`docs/mikrotik-scripts`).
13. **Self-service portal & Payment gateway** (Midtrans/Tripay/Xendit webhook) — beli voucher otomatis (Next.js penuh; PHP: modul dasar).
14. **Laporan lanjut**: grafik harian/bulanan/tahunan, per-profil, per-agen, per-router, export CSV/XLSX/PDF, proyeksi.
15. **Voucher inventory**: stok per profil, sisa umur, voucher expired massal hapus, cetak ulang, pencarian cepat, bulk action.
16. **Command palette (Ctrl+K)**, realtime (SSE/polling), PWA installable, offline shell, i18n **id/en**, dark/light/auto.
17. **Template login hotspot glass** modern (responsive, QR scan, status page) siap upload ke router.
18. **REST API + API key** untuk integrasi pihak ketiga, **import/export** user CSV.
19. **Keamanan**: password router terenkripsi (AES-256-GCM / libsodium), CSRF, rate-limit login, session aman, header CSP.
20. **Setup wizard** auto-konfigurasi router (buat API user khusus, aktifkan service api, pasang script & scheduler).

## 3. Desain UI (Gen-Z, futuristik)
- Glassmorphism utama: `backdrop-filter: blur(20px) saturate(160%)`, border 1px rgba putih 12–18%, glow neon (cyan #22d3ee, violet #8b5cf6, pink #f472b6, lime #a3e635).
- Neumorphism aksen: tombol/toggle/slider soft-shadow ganda (dark: #1b1f2e dengan shadow gelap+terang).
- Aurora/mesh gradient animasi di background, noise tipis, kartu dengan tilt/hover-glow mengikuti kursor.
- Micro-interaction: animasi angka (count-up), skeleton shimmer, toast, ripple, transisi halaman, sparkline & chart canvas.
- Font: Inter/Space Grotesk (display) + JetBrains Mono (kode voucher). Ikon SVG inline (Lucide-style).
- **Responsive**: mobile-first; sidebar → bottom tab bar di <768px, tabel → card list, tap target ≥44px, `prefers-reduced-motion` & `prefers-color-scheme` dihormati, kontras AA.

## 4. Deliverable & struktur folder
```
mikhmon/
  README.md  AGENTS.md  MEMORY.md  CHANGELOG.md  LICENSE
  docs/            PLAN.md  FEATURES.md (gap analysis)  ARCHITECTURE.md  mikrotik-scripts/
  nextmon-php/       versi PHP + JS + HTML + CSS (tanpa framework, ala Mikhmon, jalan di XAMPP/hosting/Docker)
  nextmon-next/      versi Next.js (App Router, TypeScript, fullstack, node-routeros, SQLite/Prisma)
  shared/          template login hotspot glass + template voucher cetak (HTML murni)
```

## 5. Milestone
- M0 Riset + plan + docs (selesai)
- M1 Skeleton kedua versi + design system + login + multi-router + dashboard
- M2 Hotspot: users/profiles/active/hosts/binding + generator voucher + on-login script
- M3 Laporan, template voucher, QR, POS, reseller
- M4 Tools: traffic live, torch, ping, backup, queue, firewall list, netwatch
- M5 Notifikasi, payment, API key, PWA, i18n, hardening
- M6 Test (unit + e2e), packaging (Docker), rilis v0.1

## 6. Catatan teknis RouterOS
- API plain port 8728 / API-SSL 8729 (RouterOS v6.43+ login plaintext; v6 lama challenge MD5). REST (v7.1+) opsional.
- Catatan penjualan memakai `/system script` dengan format Mikhmon v3 (pemisah `-|-`); lihat `docs/mikrotik-scripts/01-onlogin-modes.rsc` sebagai acuan (belum diverifikasi di router).
- Comment user dipakai sebagai penanda batch & tanggal expire (`vc-xxx-mm.dd.yy-batch`).
