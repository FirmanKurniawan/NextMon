# PHP dev notes (nextmon-php)
- PHP 8.4 (winget) : `C:\Users\hp\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe` (php.ini sudah mengaktifkan openssl, mbstring, sockets, curl, gd, pdo_sqlite, zip). Di shell baru cukup `php`.
- Jalankan: `NEXTMON_DEMO=1 php -S 127.0.0.1:<port> -t nextmon-php/public` (pilih port unik per agen: 8101..8106).
- Lint: `php -l file.php`.
- Titik ekstensi (tanpa edit file bersama): `src/routes.d/<modul>.php` (return array rute seperti routes.php), `src/nav.d/<modul>.php` (return [['group'=>..., 'items'=>[[key,url,icon,label,cap]]]]), `lang/id.d/<modul>.php` (English=>Indonesia).
- Controller di `src/Controllers/`, view di `src/views/`, helper di `src/helpers.php` (jangan ubah signature).
