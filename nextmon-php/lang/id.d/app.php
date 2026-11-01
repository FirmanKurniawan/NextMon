<?php
/** App-level strings added during the i18n/PWA/a11y pass. English => Indonesian. */
return [
    'A new version of NextMON is ready.' => 'Versi baru NextMON sudah siap.',
    'MikroTik hotspot manager' => 'Pengelola hotspot MikroTik', 'Reports' => 'Laporan', 'Auto' => 'Otomatis', 'Bot token' => 'Token bot', 'Chat ID' => 'ID chat',
    'Password contains an invalid character.' => 'Password berisi karakter yang tidak valid.', 'Password must be at most 72 bytes.' => 'Password maksimal 72 byte.',
    'Webhook URL rejected:' => 'URL webhook ditolak:',
    'Web Bluetooth is not supported in this browser (use Chrome on Android/desktop over HTTPS).' => 'Web Bluetooth tidak didukung di browser ini (pakai Chrome di Android/desktop lewat HTTPS).',
    'Teal' => 'Tosca', 'Blue' => 'Biru', 'Violet' => 'Ungu', 'Emerald' => 'Zamrud', 'Rose' => 'Mawar',
    'TTL' => 'TTL', 'Hop' => 'Hop', 'Loss %' => 'Loss %', 'Last' => 'Terakhir', 'Avg' => 'Rata-rata', 'Best' => 'Terbaik', 'Worst' => 'Terburuk', 'Source' => 'Sumber', 'Destination' => 'Tujuan', 'Proto' => 'Proto', 'TX' => 'TX', 'RX' => 'RX', 'Topics' => 'Topik', 'RouterOS' => 'RouterOS', 'CPU load' => 'Beban CPU', 'Memory' => 'Memori', 'Temperature' => 'Suhu', 'CPU temperature' => 'Suhu CPU', 'Voltage' => 'Tegangan', 'timeout' => 'timeout', 'received' => 'diterima', 'loss' => 'loss',
    'Popup blocked' => 'Popup diblokir',
    'BarcodeDetector / camera not supported in this browser. Use Chrome on Android or desktop (HTTPS).' => 'BarcodeDetector / kamera tidak didukung di browser ini. Pakai Chrome di Android atau desktop (HTTPS).',

    // voucher print / designs (written by the i18n pass; the voucher module may move these into voucher.php)
    '"No look-alikes" also drops 5/s, 2/z, 8/b, 9/q and u/v, so a code can be read aloud or typed without doubt.' => '"Tanpa karakter mirip" juga membuang 5/s, 2/z, 8/b, 9/q, dan u/v, sehingga kode mudah dibaca keras atau diketik tanpa ragu.',
    'ABC + 346 (no look-alikes)' => 'ABC + 346 (tanpa karakter mirip)', 'abc + 346 (no look-alikes)' => 'abc + 346 (tanpa karakter mirip)',
    'Copied.' => 'Tersalin.', 'Could not copy.' => 'Tidak bisa menyalin.', 'Group characters (abc 123)' => 'Kelompokkan karakter (abc 123)',
    'Image QR (older printers)' => 'QR gambar (printer lama)', 'Native ESC/POS QR (fast)' => 'QR ESC/POS asli (cepat)', 'No QR, text only' => 'Tanpa QR, hanya teks',
    'No.' => 'No.', 'QR on thermal printers (RawBT / Bluetooth)' => 'QR di printer thermal (RawBT / Bluetooth)',
    'Sending many vouchers with image QR codes is slow over Bluetooth. Continue?' => 'Mengirim banyak voucher dengan QR gambar lewat Bluetooth itu lambat. Lanjutkan?',
    'Sending to the printer...' => 'Mengirim ke printer...', 'Sent to the printer.' => 'Terkirim ke printer.',
    'Shown by the Wi-Fi Card design. The password is public by design: it is printed on the card.' => 'Ditampilkan oleh desain Kartu Wi-Fi. Password ini memang publik: dicetak di kartu.',
    'Some codes contain I, l or O. They are underlined on the card; a slashed zero is the digit 0. The gap inside a code is only for reading.' => 'Sebagian kode memuat I, l, atau O. Karakter itu digarisbawahi di kartu; nol bergaris miring adalah angka 0. Spasi di dalam kode hanya untuk memudahkan membaca.',
    'The gap in a grouped code is only for reading. Copy, PNG and the QR always use the raw code.' => 'Spasi pada kode berkelompok hanya untuk memudahkan membaca. Salin, PNG, dan QR selalu memakai kode asli.',
    'Thermal width follows the paper: 80 mm uses 48 columns, anything else 58 mm / 32 columns. Sends the selected card, or all.' => 'Lebar thermal mengikuti kertas: 80 mm memakai 48 kolom, selain itu 58 mm / 32 kolom. Mengirim kartu terpilih, atau semuanya.',
    'Too much data for the RawBT link. Use native QR or fewer vouchers.' => 'Data terlalu besar untuk tautan RawBT. Pakai QR asli atau kurangi voucher.',
    'Wi-Fi network' => 'Jaringan Wi-Fi', 'Wi-Fi network name (set in the print view)' => 'Nama jaringan Wi-Fi (diatur di tampilan cetak)', 'Wi-Fi password' => 'Password Wi-Fi', 'Wi-Fi password (set in the print view)' => 'Password Wi-Fi (diatur di tampilan cetak)',
    // auth
    'Invalid API port (1-65535). Default is 8728, or 8729 for API-SSL.' => 'Port API tidak valid (1-65535). Bawaan 8728, atau 8729 untuk API-SSL.',
    'Setup is locked. Open /setup?token=... with the value of NEXTMON_SETUP_TOKEN.' => 'Setup terkunci. Buka /setup?token=... dengan nilai NEXTMON_SETUP_TOKEN.',
];
