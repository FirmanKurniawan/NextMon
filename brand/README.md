# Brand NextMON

Logo: huruf **N** tebal dengan dua busur sinyal yang memancar dari ujung kanan atas, pada tile teal bergradasi dengan kilap kaca tipis.

- `mark.svg` / `mark-tile.svg` — logo utama (tile). `mark-plain.svg` — glyph satu warna (`currentColor`, ikut warna aksen aplikasi).
- `logo.svg` — lockup horizontal (tile + "NextMON"; teks memakai font sistem, ubah ke path untuk cetak).
- Warna: tile `#1aa9bf → #0a5b70`, teks `#0f2a33`, aksen `#0e7490`.
- Ruang aman minimal 1/4 tinggi logo; ukuran minimum 16 px.
- Semua SVG dibuat dari satu geometri: `python brand/gen-logo.py`. Ikon PWA/favicon: `NODE_PATH=<folder berisi node_modules/@resvg/resvg-js> node brand/build-icons.js`
  (juga menyalin tile ke `nextmon-php` dan `shared/hotspot-login`). Helper `brand_mark()` di `nextmon-php/src/helpers.php` berisi salinan glyph inline (viewBox `7 6 50 50`).
