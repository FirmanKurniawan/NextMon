<p align="center"><img src="brand/logo.svg" alt="NextMON" height="64"></p>

# NextMON — Hotspot MikroTik Manager generasi baru

Pesaing [Mikhmon](https://laksa19.github.io/) dengan UI glassmorphism/neumorphism futuristik, responsif, dan fitur jauh lebih lengkap
(grafik live, role & reseller, POS, notifikasi, QR voucher, backup otomatis, API, PWA, dll). Tanpa RADIUS — langsung via RouterOS API.

| Folder | Isi |
|---|---|
| [`nextmon-php/`](nextmon-php/) | Versi PHP + JS + HTML + CSS, ala Mikhmon (XAMPP / hosting / Docker) |
| [`nextmon-next/`](nextmon-next/) | Versi Next.js fullstack (TypeScript) — fondasi multi-akun, UI fitur menyusul |
| [`shared/`](shared/) | Template login hotspot glass & template voucher cetak |
| [`docs/`](docs/) | PLAN, FEATURES (gap analysis), ARCHITECTURE, skrip RouterOS |

**NextMON Server** (peluncur Windows `.exe`: tray, panel kontrol, manajer runtime PHP/Node, menjalankan satu edisi dalam satu waktu) ada di repo terpisah: [NextMON-Server](https://github.com/FirmanKurniawan/NextMON-Server). Paket rilis (lite/full) ada di halaman Releases.

## Multi-akun
Satu instalasi bisa dipakai banyak pemilik: akun dibuat admin platform, tiap pemilik menambah router sendiri (data terpisah per workspace, router bisa dibagikan ro/rw). Spek: [docs/MULTITENANT.md](docs/MULTITENANT.md). Edisi PHP lolos suite isolasi (`nextmon-php/tests/tenant_isolation_test.php`); sebelum membuka layanan untuk orang lain tetap lakukan tinjauan keamanan sendiri.

## Mulai cepat
```bash
# Next.js
cd nextmon-next && npm install && npm run dev      # http://localhost:3000 (mode demo bawaan)

# PHP (butuh PHP 8.1+)
php -S localhost:8080 -t nextmon-php/public nextmon-php/public/index.php   # atau di Windows: .start-php.cmd
```
Kedua versi punya **mode demo** (data palsu) sehingga bisa dicoba tanpa router.

## Dokumen
[PLAN](docs/PLAN.md) · [FEATURES](docs/FEATURES.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [AGENTS](AGENTS.md) · [MEMORY](MEMORY.md) · [CHANGELOG](CHANGELOG.md)

## Status
Pra-rilis (v0.1 dev). Lihat README tiap folder untuk apa yang sudah teruji. Nama produk: NextMON.

Proyek independen, tidak berafiliasi dengan Mikhmon/Laksa19 maupun MikroTik. Kode ditulis dari nol berdasarkan dokumentasi RouterOS.
