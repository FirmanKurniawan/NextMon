# ============================================================================
# 02 - Scheduler pembersih (tiap jam)
# 1) Hapus scheduler "kl-exp-*" yatim (user sudah tidak ada).
# 2) Hapus user mode ntf yang sudah dikunci (limit-uptime=1s) dan tidak aktif, bila $purge = true.
# UNVERIFIED: belum diuji. Policy: read,write,policy,test
# ============================================================================
/system script remove [find name="nextmon-cleanup"]
/system script add name="nextmon-cleanup" policy=read,write,policy,test source={
:local purge false
:foreach s in=[/system scheduler find where name~"^kl-exp-"] do={
  :local n [/system scheduler get $s name]
  :local u [:pick $n 7 [:len $n]]
  :if ([:len [/ip hotspot user find where name=$u]]=0) do={
    /system scheduler remove $s
    :log info ("nextmon-cleanup: scheduler yatim dihapus " . $n)
  }
}
:if ($purge) do={
  :foreach i in=[/ip hotspot user find where limit-uptime=1s] do={
    :local u [/ip hotspot user get $i name]
    :if ([:len [/ip hotspot active find where user=$u]]=0) do={
      /ip hotspot user remove $i
      :log info ("nextmon-cleanup: user kadaluarsa dihapus " . $u)
    }
  }
}
}
/system scheduler remove [find name="nextmon-cleanup"]
/system scheduler add name="nextmon-cleanup" interval=1h start-time=startup on-event="/system script run nextmon-cleanup" policy=read,write,policy,test comment="nextmon"
# Ubah ":local purge false" menjadi true di script untuk menghapus user ntf kadaluarsa otomatis.
