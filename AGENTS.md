# AGENTS.md — Panduan untuk agen AI / kontributor

Proyek: **NextMON** (pesaing Mikhmon). Baca `docs/PLAN.md` dan `MEMORY.md` dulu.

## Aturan
- Bahasa UI default Indonesia, dukung `en`. Komentar kode: Inggris singkat. Dokumen: Indonesia.
- Satu agen = satu direktori. Jangan edit file di luar direktori tugas (`nextmon-php/`, `nextmon-next/`, `shared/`, `docs/`).
- Jangan menaruh kredensial nyata. Password router wajib terenkripsi saat disimpan.
- Semua pemanggilan RouterOS lewat satu lapisan client (PHP: `src/RouterOS.php`, Next: `src/lib/routeros.ts`).
- Mode **demo/mock** wajib ada (data palsu) agar UI bisa dicoba tanpa router.
- UI: glassmorphism + neumorphism aksen, responsive mobile-first, dukung dark/light, hormati reduced-motion.
- Setiap fitur baru → catat di `CHANGELOG.md` (format Keep a Changelog) dan `MEMORY.md` bila ada keputusan penting.
- Jangan fabrikasi hasil tes; laporkan apa yang benar-benar dijalankan.

## Perintah
- PHP: `php -S localhost:8080 -t nextmon-php/public nextmon-php/public/index.php` (PHP 8.1+; mode demo: `NEXTMON_DEMO=1`)
- Next: `cd nextmon-next && npm install && npm run dev`
