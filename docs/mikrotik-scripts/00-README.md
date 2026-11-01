# Script RouterOS NextMON

Tempel ke Terminal (Winbox/SSH) atau `/import file-name=xxx.rsc`. Semua script ditulis dari pengetahuan RouterOS v6.43+/v7;
**tidak ada yang diuji pada perangkat nyata** (lingkungan penulis tanpa router/CHR). Tiap file memuat tanda
`VERIFIED` atau `UNVERIFIED` pada bagian yang berisiko. Uji dulu di CHR/router cadangan; baca `/log print` setelah dijalankan.

| File | Isi |
|---|---|
| 01-onlogin-modes.rsc | script induk `nextmon-onlogin` + 4 stub mode rem / ntf / remc / ntfc (kompatibel Mikhmon) |
| 02-expiry-cleanup.rsc | scheduler pembersih scheduler yatim & user kadaluarsa (ntf) |
| 03-auto-backup.rsc | backup + export harian, rotasi, opsional upload |
| 04-netwatch-telegram.rsc | notifikasi host/link offline ke Telegram |
| 05-low-stock-alert.rsc | alert stok voucher rendah |
| 06-enable-api-service.rsc | aktifkan api / api-ssl + sertifikat |
| 07-api-user-least-privilege.rsc | group & user API khusus |
| 08-walled-garden.rsc | walled garden default |

Semantik mode (sama dengan Mikhmon): `rem` hapus user saat expired; `ntf` biarkan (user diberi limit-uptime 1s sehingga tak bisa login);
`remc`/`ntfc` sama tetapi **mencatat penjualan** ke `/system script` (comment=mikhmon).
Urutan pasang: 07 -> 06 -> 01 -> 02 -> (04 -> 05) -> 03 -> 08. 04 harus ada sebelum 05 (05 memanggil `nextmon-tg`).
