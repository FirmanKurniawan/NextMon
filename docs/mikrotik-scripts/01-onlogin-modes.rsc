# ============================================================================
# 01 - On-login script NextMON (kompatibel Mikhmon v3)
# Policy user yang menjalankan: read,write,policy,test
# UNVERIFIED: seluruh logika belum diuji di router nyata.
# UNVERIFIED: format "next-run" scheduler (v6 vs v7) dipakai untuk menghitung tanggal expired
#             (trik yang sama dipakai Mikhmon). Jika kosong, comment tidak diisi tanggal.
# Format catatan penjualan (sama dengan Mikhmon) -> nama script:
#   date-|-time-|-user-|-price-|-address-|-mac-|-validity-|-profile-|-comment
#   owner="<bulan><tahun>"  source=<date>  comment=mikhmon
# ============================================================================

# ---- Script induk (logika). Dipanggil oleh stub di tiap profile. -----------
/system script remove [find name="nextmon-onlogin"]
/system script add name="nextmon-onlogin" policy=read,write,policy,test source={
:global kluser; :global klmode; :global klprice; :global klvalid
:global klsell; :global kllock; :global kladdr; :global klmac; :global klprof
:local date [/system clock get date]
:local time [/system clock get time]
:local id [/ip hotspot user find where name=$kluser]
:if ([:len $id]=0) do={ :error "nextmon: user tidak ada" }
:local comment [/ip hotspot user get $id comment]
:local pre [:pick $comment 0 2]
# Hanya login PERTAMA (comment kosong / diawali vc / up)
:if ($pre="vc" or $pre="up" or $comment="") do={
  # --- hitung tanggal expired lewat scheduler sementara (trik Mikhmon)
  :local tmp ("kl-tmp-" . $kluser)
  /system scheduler remove [find name=$tmp]
  /system scheduler add name=$tmp disable=no start-date=$date start-time=$time interval=$klvalid
  :delay 1s
  :local exp [/system scheduler get [find name=$tmp] next-run]
  /system scheduler remove [find name=$tmp]
  :if ([:len $exp]>0) do={ /ip hotspot user set $id comment=$exp }
  # --- scheduler expired per user
  :local en ("kl-exp-" . $kluser)
  /system scheduler remove [find name=$en]
  :local ev ""
  :if ($klmode="rem" or $klmode="remc") do={
    :set ev ("/ip hotspot active remove [find user=\"" . $kluser . "\"]; /ip hotspot user remove [find name=\"" . $kluser . "\"]; /system scheduler remove [find name=\"" . $en . "\"]")
  } else={
    :set ev ("/ip hotspot active remove [find user=\"" . $kluser . "\"]; /ip hotspot user set limit-uptime=1s [find name=\"" . $kluser . "\"]; /system scheduler remove [find name=\"" . $en . "\"]")
  }
  /system scheduler add name=$en disable=no start-date=$date start-time=$time interval=$klvalid on-event=$ev policy=read,write,policy,test comment="nextmon-expire"
  # --- lock MAC
  :if ($kllock="Enable") do={ /ip hotspot user set $id mac-address=$klmac }
  # --- catat penjualan hanya untuk mode ...c
  :if ($klmode="remc" or $klmode="ntfc") do={
    :local mon "jan"
    :local year ""
    :if ([:pick $date 4 5]="-") do={
      :local mm [:pick $date 5 7]
      :local names {"jan";"feb";"mar";"apr";"may";"jun";"jul";"aug";"sep";"oct";"nov";"dec"}
      :set mon ($names->([:tonum $mm]-1))
      :set year [:pick $date 0 4]
    } else={
      :set mon [:pick $date 0 3]
      :set year [:pick $date 7 11]
    }
    /system script add name=("$date-|-$time-|-$kluser-|-$klprice-|-$kladdr-|-$klmac-|-$klvalid-|-$klprof-|-$comment") owner=("$mon$year") source=$date comment=mikhmon
  }
}
}
# UNVERIFIED: :tonum pada "08"/"09" mungkin dianggap oktal di beberapa versi -> uji bulan Agustus/September.

# ---- Stub per profile. Ganti nama profile, harga, validity. -----------------
# Header ":put (",mode,price,validity,selling,lock,")" dibaca Mikhmon/NextMON untuk menampilkan pengaturan profile.

# MODE rem  (hapus saat expired, tanpa catat penjualan)
/ip hotspot user profile set [find name="paket-1jam"] on-login=":put (\",rem,2000,1h,2000,,Disable,\"); :global kluser \$user; :global klmode \"rem\"; :global klprice \"2000\"; :global klvalid \"1h\"; :global klsell \"2000\"; :global kllock \"Disable\"; :global kladdr \$address; :global klmac \$\"mac-address\"; :global klprof \"paket-1jam\"; /system script run nextmon-onlogin"

# MODE ntf  (biarkan, user dikunci; tanpa catat)
/ip hotspot user profile set [find name="paket-1hari"] on-login=":put (\",ntf,5000,1d,5000,,Disable,\"); :global kluser \$user; :global klmode \"ntf\"; :global klprice \"5000\"; :global klvalid \"1d\"; :global klsell \"5000\"; :global kllock \"Disable\"; :global kladdr \$address; :global klmac \$\"mac-address\"; :global klprof \"paket-1hari\"; /system script run nextmon-onlogin"

# MODE remc (hapus + catat penjualan)
/ip hotspot user profile set [find name="paket-7hari"] on-login=":put (\",remc,25000,7d,25000,,Enable,\"); :global kluser \$user; :global klmode \"remc\"; :global klprice \"25000\"; :global klvalid \"7d\"; :global klsell \"25000\"; :global kllock \"Enable\"; :global kladdr \$address; :global klmac \$\"mac-address\"; :global klprof \"paket-7hari\"; /system script run nextmon-onlogin"

# MODE ntfc (biarkan + catat penjualan)
/ip hotspot user profile set [find name="paket-30hari"] on-login=":put (\",ntfc,80000,30d,80000,,Enable,\"); :global kluser \$user; :global klmode \"ntfc\"; :global klprice \"80000\"; :global klvalid \"30d\"; :global klsell \"80000\"; :global kllock \"Enable\"; :global kladdr \$address; :global klmac \$\"mac-address\"; :global klprof \"paket-30hari\"; /system script run nextmon-onlogin"

# UNVERIFIED: ":global" di on-login lalu "script run" -> variabel global dibagi lintas script (perilaku RouterOS standar),
#             tetapi dua login bersamaan bisa saling menimpa; risiko rendah karena script berjalan cepat.
# UNVERIFIED: apakah $user, $address, $"mac-address" tersedia di on-login (ya pada dokumentasi Hotspot / dipakai Mikhmon).
# Nama profile ditulis literal pada stub (bukan variabel) agar tidak bergantung pada variabel yang tak terverifikasi.
