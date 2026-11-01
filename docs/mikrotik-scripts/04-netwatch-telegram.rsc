# ============================================================================
# 04 - Netwatch -> Telegram (host/link offline & pulih)
# UNVERIFIED: belum diuji. Policy: read,write,test,policy
# Isi BOT_TOKEN & CHAT_ID. Token tersimpan di router -> batasi akses (policy sensitive/read).
# HTTPS: lebih aman import sertifikat root lalu check-certificate=yes-without-crl (v7) / yes (v6);
# di bawah dipakai check-certificate=no agar jalan tanpa persiapan (kurang aman).
# ============================================================================
/system script remove [find name="nextmon-tg"]
/system script add name="nextmon-tg" policy=read,write,test source={
:global kltgmsg
:local tok "BOT_TOKEN"
:local chat "CHAT_ID"
# url-encode sederhana: spasi -> %20, # -> %23, & -> %26
:local out ""
:for i from=0 to=([:len $kltgmsg]-1) do={
  :local c [:pick $kltgmsg $i ($i+1)]
  :if ($c=" ") do={ :set c "%20" }
  :if ($c="#") do={ :set c "%23" }
  :if ($c="&") do={ :set c "%26" }
  :set out ($out . $c)
}
/tool fetch url=("https://api.telegram.org/bot" . $tok . "/sendMessage") http-method=post http-data=("chat_id=" . $chat . "&text=" . $out) keep-result=no check-certificate=no
}

# Contoh: pantau 8.8.8.8 (ganti dengan IP AP/server/WAN cadangan).
/tool netwatch remove [find comment="nextmon"]
/tool netwatch add host=8.8.8.8 interval=30s timeout=2s comment="nextmon" down-script=":global kltgmsg (\"[NextMON] OFFLINE: 8.8.8.8 dari \" . [/system identity get name]); /system script run nextmon-tg" up-script=":global kltgmsg (\"[NextMON] PULIH: 8.8.8.8 dari \" . [/system identity get name]); /system script run nextmon-tg"

# CATATAN: bila WAN mati, router tidak dapat mengirim Telegram. "Router offline" yang sesungguhnya dideteksi oleh
# server NextMON dari luar (heartbeat API, lihat ARCHITECTURE bagian Realtime). Netwatch berguna untuk perangkat
# di bawah router (AP, server, WAN cadangan) dan pesan "pulih" setelah link kembali.
