# FEATURES — Gap Analysis Mikhmon v3/v4 vs NextMON

> Status verifikasi: `help.mikrotik.com` tidak dapat diakses dari lingkungan penulis (DNS gagal), jadi nama path/command
> di bawah ditulis dari pengetahuan RouterOS v6/v7 dan ditandai **[V]** (yakin, sudah lama stabil) atau **[?]**
> (perlu diuji di perangkat nyata / dicek ke dokumentasi). Dokumen resmi acuan:
> - https://help.mikrotik.com/docs/spaces/ROS/pages/328151/Hotspot
> - https://help.mikrotik.com/docs/spaces/ROS/pages/47579160/API (protokol API & REST)
> - https://wiki.mikrotik.com/wiki/Manual:API
> - https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST+API

Konvensi: path API memakai `/` (mis. `/ip/hotspot/user/print`), setara CLI `/ip hotspot user print`.
Aksi API standar: `print`, `add`, `set`, `remove`, `enable`, `disable`, `getall`. Argumen berbentuk `=nama=nilai`,
query `?nama=nilai`, `.proplist=`, `.id=*1A`.

## 1. Keluhan / permintaan pengguna Mikhmon (sumber)

| Temuan | Sumber |
|---|---|
| Permintaan kuota berjenjang (kuota habis tapi waktu tersisa -> tak bisa login); dijawab maintainer: tidak akan ditambah karena Hotspot profile lebih terbatas dari RADIUS | https://github.com/laksa19/mikhmonv2/issues/2 |
| Permintaan fitur "Cek Voucher" (cek sisa pemakaian oleh pelanggan) | https://github.com/laksa19/mikhmonv2/issues/1 |
| Pesan error login (uptime limit / traffic limit habis) hanya via template, tidak ada notifikasi ke admin | https://github.com/laksa19/template-hotspot-mikhmon/blob/master/hotspot7/errors.txt |
| Fork komunitas masih memperbaiki bug dasar (form generate, voucher-result retry, PHP audit) -> basis kode rapuh | https://github.com/nextganwifi-sudo/mikhmon/pull/3 |
| Changelog v3 menunjukkan fitur kecil-kecil (mis. hitung sisa voucher di komentar) -> belum ada inventori voucher | https://github.com/laksa19/mikhmonv3 |
| Proyek asli: https://github.com/laksa19/mikhmonv3 , https://github.com/laksa19/mikhmonv2 | - |

Keluhan umum lain (dari pengamatan komunitas; **tidak diverifikasi per-URL**, perlakukan sebagai hipotesis): UI tidak
responsif di HP, tak ada multi-user/role (agen/kasir), laporan hanya lewat `/system script` sehingga lambat bila ribuan
entri, tak ada notifikasi, kredensial router tersimpan lemah, tak ada backup terjadwal, tak ada pembayaran online.

## 2. Tabel gap & perintah RouterOS

Prioritas: **P0** nilai tinggi/usaha rendah-sedang (rilis v0.1), **P1** nilai sedang/tinggi, usaha sedang, **P2** nilai niche / usaha besar.
Izin = policy RouterOS minimum pada group API user (`read`, `write`, `api`, `test`, `policy`, `ftp`, `sensitive`, `reboot`, `romon`).

| # | Fitur NextMON | Mikhmon | Perintah/path API RouterOS | Catatan v6 / v7 | Risiko & izin | Prio |
|---|---|---|---|---|---|---|
| 1 | Hotspot user CRUD + batch generate | Ada | `/ip/hotspot/user/{print,add,set,remove,disable}`; arg `name password profile server limit-uptime limit-bytes-total comment` **[V]** | Sama v6/v7 | write. Batch besar: kirim berurutan, hindari ratusan perintah paralel (CPU router) | P0 |
| 2 | User profile + on-login script | Ada | `/ip/hotspot/user/profile/{print,add,set}` arg `rate-limit shared-users on-login keepalive-timeout` **[V]** | Sama | write+policy+test (script on-login memerlukan policy `read,write,policy,test` pada user yang menjalankannya) | P0 |
| 3 | Active/hosts/IP-binding/cookie | Ada | `/ip/hotspot/{active,host,ip-binding,cookie}/print`; `/ip/hotspot/active/remove` (kick); `/ip/hotspot/ip-binding/add type=bypassed|blocked` **[V]** | Sama | write | P0 |
| 4 | Laporan penjualan kompatibel | Ada | `/system/script/print ?comment=mikhmon` (+`?owner=mmmYYYY`) **[V]** | Sama; baca ribuan entri lambat -> cache ke DB NextMON (lihat ARCHITECTURE) | read | P0 |
| 5 | Resource & health live | Dashboard dasar | `/system/resource/print` ; `/system/health/print` (v6: tabel satu baris; v7: baris per sensor `name,value,type`) **[V]** | **Format health beda v6 vs v7**: normalisasi. Banyak model (hAP lite) tak punya sensor -> kosong | read | P0 |
| 6 | Grafik traffic interface live | Tidak | `/interface/monitor-traffic =interface=ether1 =once=` (poll) atau tanpa `once` streaming (tag `.tag`, `/cancel`) **[V]** | Sama. Streaming memegang koneksi API; pakai polling 1-2 dtk atau satu stream bersama | read; beban rendah | P0 |
| 7 | Daftar interface & status | Tidak | `/interface/print` , `/interface/ethernet/print` **[V]** | v7: `/interface/ethernet/monitor` **[?]** | read | P1 |
| 8 | Torch / top talkers | Tidak | `/tool/torch =interface=bridge =src-address=0.0.0.0/0 =dst-address=0.0.0.0/0 =duration=5s` (streaming) **[V]** | Sama; sebaiknya batasi `duration`, 1 sesi torch per router | **test** policy; CPU naik | P1 |
| 9 | Ping / traceroute | Tidak | `/ping =address= =count=4` (streaming), `/tool/traceroute =address=` **[V]** | v7 traceroute ada field tambahan | test | P1 |
| 10 | Bandwidth test | Tidak | `/tool/bandwidth-test =address= =direction= =protocol= =duration=` **[V]** | Butuh remote bw-server; makan bandwidth WAN | test; **risiko tinggi** menjenuhkan link -> Admin saja, konfirmasi | P2 |
| 11 | Simple queue manager / limit | Tidak | `/queue/simple/{print,add,set,remove,disable}` arg `name target max-limit limit-at parent` **[V]** | Sama | write | P1 |
| 12 | Ubah rate-limit user aktif | Tidak | cari queue dinamis hotspot `/queue/simple/print ?name=<hs-user>` lalu `set max-limit`; atau `set rate-limit` di profile + `/ip/hotspot/active/remove` agar relogin **[?]** | Queue dinamis hotspot bisa hilang saat relogin; cara pasti = ubah user profile lalu kick | write | P1 |
| 13 | Kuota/FUP per voucher | Terbatas | `limit-bytes-total`, `limit-bytes-in/out`, `limit-uptime` pada hotspot user **[V]**; kuota berjenjang tidak didukung hotspot (lihat issue #2) | Sama. Workaround: scheduler yang mengganti profile saat byte tertentu **[?]** | write | P1 |
| 14 | Firewall address-list (block/allow) | Tidak | `/ip/firewall/address-list/{print,add,remove}` arg `list address timeout comment` **[V]**; MAC blacklist: `/ip/hotspot/ip-binding type=blocked` atau `/interface/wireless/access-list` / `/interface/wifi/access-list` (v7 wifi pkg) **[?]** | Aturan firewall yang memakai list harus sudah ada (setup wizard menambahkannya) | write; salah aturan dapat memutus akses admin -> jangan pernah menyentuh list `nextmon-admin` | P1 |
| 15 | Walled garden | Tidak | `/ip/hotspot/walled-garden/{print,add,remove}` dan `.../ip/` (`dst-address`, `dst-host`, `action`) **[V]** | Sama | write | P1 |
| 16 | DHCP lease & ARP | Tidak | `/ip/dhcp-server/lease/{print,add,make-static,remove}`; `/ip/arp/print` **[V]** | Sama | write | P1 |
| 17 | PPPoE secret/active | Tidak | `/ppp/secret/{print,add,set,remove,disable}`, `/ppp/active/{print,remove}`, `/ppp/profile/print` **[V]** | Sama | write; `sensitive`? password secret terbaca dengan policy `sensitive` | P2 |
| 18 | Scheduler & script manager | Sebagian | `/system/scheduler/*`, `/system/script/{print,add,run}` (`run` mengambil `.id`) **[V]** | Sama | write+policy+test; script berisi kredensial -> hindari | P1 |
| 19 | Netwatch / status router | Tidak | Di router: `/tool/netwatch` (up-script/down-script, lihat `.rsc`). Dari NextMON: `/tool/netwatch/print` **[V]**; heartbeat NextMON = coba connect API + `/system/identity/print` | v7 netwatch punya tipe probe (`type=icmp|tcp-conn|http-get`) **[?]** | read | P0 |
| 20 | Auto-backup & export | Tidak | `/system/backup/save =name=nextmon =password=...` ; `/export =file=nextmon-export` (v7: `show-sensitive`, v6: `hide-sensitive` default berbeda) ; unduh via FTP/SFTP/SCP atau `/file/print` **[V]** | **API tidak bisa mengunduh file** -> butuh `ftp` policy + layanan FTP/SFTP, atau script router `/tool fetch upload=yes` ke server NextMON | write, ftp, sensitive; berkas backup mengandung kredensial -> enkripsi & batasi akses | P1 |
| 21 | Reboot / shutdown | Tidak | `/system/reboot`, `/system/shutdown` **[V]** | Sama | `reboot`; Admin saja + konfirmasi + audit | P2 |
| 22 | Log viewer | Ada | `/log/print` (filter `?topics=hotspot`) **[V]** | Sama | read | P1 |
| 23 | Voucher QR / cetak / PDF | Tidak | Tanpa RouterOS (render lokal); URL login: `http://<dns-name>/login?username=U&password=P` **[V]** | Hotspot mendukung query `username` & `password` pada `/login` | tak ada; kode QR memuat kredensial -> cetak saja | P0 |
| 24 | Voucher inventory & hapus expired massal | Terbatas | `/ip/hotspot/user/print ?uptime=0s` (belum terpakai), `?disabled=true`; hapus massal: kirim `remove` per `.id` **[V]** | Sama; komentar `vc-...` dipakai sbg batch | write | P0 |
| 25 | Alert stok voucher rendah | Tidak | Di router: script scheduler (lihat `.rsc`); atau di NextMON: hitung `user/print` tanpa `uptime` per profil | - | read | P1 |
| 26 | Notifikasi Telegram/WA/webhook | Tidak | Router->Telegram: `/tool/fetch url="https://api.telegram.org/bot<TOKEN>/sendMessage" http-method=post http-data=... keep-result=no` **[V]** | v6.4x+ `fetch` punya `http-method/http-data`; HTTPS butuh sertifikat CA (`check-certificate=no` kurang aman) | token bot tersimpan di script router -> baca-saja oleh policy `sensitive`/`read`; batasi | P0 |
| 27 | Reseller/POS/saldo | Tidak | Tanpa RouterOS (DB NextMON) + `user/add` | - | kontrol saldo atomik di DB | P0 |
| 28 | RBAC, audit, 2FA, API key | Tidak | Tanpa RouterOS | - | lihat ARCHITECTURE | P0 |
| 29 | Payment gateway self-service | Tidak | Webhook -> NextMON -> `/ip/hotspot/user/add` | - | validasi signature webhook; idempotensi | P1 |
| 30 | Setup wizard (API user, service, script) | Manual | `/user/group/add`, `/user/add`, `/ip/service/set =name=api-ssl`, `/system/script/add`, `/system/scheduler/add` **[V]** | api-ssl butuh sertifikat: `/certificate/add` + `/certificate/sign` (+ `set api-ssl certificate=`) | Butuh akun admin sekali pakai; **jangan simpan** kredensial admin | P1 |
| 31 | Import/export CSV user | Tidak | `user/add` batch | - | write | P2 |
| 32 | Hotspot login page editor/template | Ada | upload via FTP ke `hotspot/` **[V]** | API tak bisa upload file | ftp | P2 |
| 33 | Queue tree / mangle (QoS lanjutan) | Tidak | `/queue/tree/*`, `/ip/firewall/mangle/*` | Kompleks | risiko salah konfigurasi tinggi | P2 |
| 34 | Wireless client / CAPsMAN | Tidak | `/interface/wireless/registration-table/print` (v6) ; v7: `/interface/wifi/registration-table/print` atau wireless pkg lama **[?]** | **Path beda v6/v7** | read | P2 |

## 3. Caveat RouterOS v6 vs v7 (ringkas)
1. **Login API**: v6.43+ dan v7 -> kirim `/login =name= =password=` plaintext (aman hanya di API-SSL 8729 atau jaringan terpercaya). v6 < 6.43 -> challenge MD5 (`=response=00...`). Pustaka `node-routeros` menangani keduanya; di PHP pakai RouterOS API class Mikhmon/`evilfreelancer/routeros-api-php`.
2. **REST API** hanya v7.1+ (`https://router/rest/...`, basic auth, HTTPS di `www-ssl`). Pakai sebagai opsi, bukan wajib, karena mayoritas pengguna Mikhmon masih v6.
3. **`/system/health`** berbeda format (lihat #5). **`/export`**: opsi `show-sensitive` (v7) vs `hide-sensitive` (v6; default v6.x menyertakan sensitif) **[?]**.
4. **`/tool/fetch`**: v7 mendukung `check-certificate=yes-without-crl`; v6 lama hanya `no`/`yes`. Telegram memerlukan sertifikat root (import CA bundle `/certificate/import`) **[?]**.
5. **Wireless**: v7 memisahkan paket `wifi` (wifiwave2/wifi-qcom) vs `wireless`.
6. **Scripting**: `:local` variabel dan `:foreach` sama; v7 menambah `:serialize/:deserialize`, `:convert`. Script di folder ini ditulis kompatibel v6.43+ dan v7 (tanpa fitur khusus v7).
7. **Format tanggal `/system clock get date`**: v6 `jan/02/2026`, v7 `2026-01-02` (tergantung `date-format` / versi). Script on-login Mikhmon asli memakai parsing tanggal ala v6; NextMON membuat script yang mendeteksi keduanya **[?: perlu uji di v7 nyata]**.
8. **Limit**: satu koneksi API ~ puluhan MB RAM di perangkat kecil; gunakan pool koneksi 1 per router.

## 4. Peringkat nilai vs usaha

- **P0 (v0.1)**: #1-6, 19, 23, 24, 26, 27, 28 — paritas + grafik live + role/audit + notifikasi dasar + voucher QR.
- **P1**: #7-9, 11-16, 18, 20, 22, 25, 29, 30.
- **P2**: #10, 17, 21, 31-34.

## 5. Matriks risiko izin (API user)

| Group NextMON | Policy RouterOS |
|---|---|
| `nextmon-read` (Viewer) | `read,api` |
| `nextmon-op` (Operator/Agen/POS) | `read,write,api,test` (+`policy` hanya jika mengelola profile on-login) |
| `nextmon-admin` (Wizard/Backup) | `read,write,api,test,policy,ftp,sensitive` — hanya bila fitur backup/wizard dipakai; tidak `reboot`, `password`, `sniff` secara default |

Prinsip: user API khusus per router, dibatasi `address=<IP server NextMON>/32`, tanpa `winbox/ssh/telnet/web`
policy, password acak 24+ karakter. Lihat `mikrotik-scripts/07-api-user-least-privilege.rsc`.

## 6. Penjualan reseller lewat toko publik (PHP + Next, perilaku identik)

- Reseller punya **kode referal** (3-24 karakter a-z, 0-9, `-`; unik per workspace) yang diatur admin di halaman Reseller; tautan toko: `/shop?w=<slug>&ref=<kode>` (tampil juga di Dompet saya).
- `ref` adalah satu-satunya nilai pilihan klien dan HANYA menandai pesanan (`order.attr`): tidak pernah mengubah workspace, harga, atau produk. Kode tak dikenal / reseller nonaktif / kode workspace lain diabaikan diam-diam (pesanan tetap jalan tanpa atribusi).
- Komisi dikreditkan ke buku besar dompet reseller (tipe `commission`, `ref` = id pesanan, meta `order`) saat pesanan LUNAS dan voucher terkirim: `round(total pesanan x persen komisi)`, dihitung di server dari total pesanan yang terverifikasi (nominal webhook harus sama). Toko tidak punya markup harga (pengaturan "price adj." hanya untuk POS/voucher), jadi mode kedua tidak dipakai.
- Tepat sekali: dijaga kunci per-pesanan + flag `attr.credited_at` + guard buku besar (`once`, tipe+ref). Replay webhook, callback paralel, dan retry tidak menggandakan. Refund pesanan membalik komisi tepat sekali (entri `commission` negatif, `ref = rev:<id pesanan>`).
- Admin: detail pesanan menampilkan reseller + status komisi (menunggu / dikreditkan / dibatalkan); buku besar menautkan ke pesanan; CSV pesanan memuat `reseller_ref` dan `commission`.
- Tes: `nextmon-php/tests/unit/ShopResellerTest.php`, `nextmon-next/tests/unit/shop-reseller.test.ts`.
