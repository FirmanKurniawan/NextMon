# ============================================================================
# 03 - Auto backup + export harian (03:00), simpan 7 terakhir
# UNVERIFIED: belum diuji. Policy: read,write,policy,test,ftp,sensitive
# .backup berisi kredensial -> gunakan password. Ganti PASSWORD_BACKUP.
# API RouterOS tidak bisa mengunduh file; ambil lewat SFTP/FTP atau aktifkan upload di bawah.
# ============================================================================
/system script remove [find name="nextmon-backup"]
/system script add name="nextmon-backup" policy=read,write,policy,test,ftp,sensitive source={
:local pass "PASSWORD_BACKUP"
:local id [/system identity get name]
:local d [/system clock get date]
# ganti "/" dan spasi pada tanggal (v6: jan/02/2026) dengan "-"
:local safe ""
:for i from=0 to=([:len $d]-1) do={
  :local c [:pick $d $i ($i+1)]
  :if ($c="/" or $c=" ") do={ :set c "-" }
  :set safe ($safe . $c)
}
:local base ("nextmon-" . $id . "-" . $safe)
/system backup save name=$base password=$pass
/export compact file=$base
:delay 3s
# rotasi: sisakan 7 file terbaru per jenis
# UNVERIFIED: urutan /file find tidak dijamin kronologis; nama berisi tanggal format v6 tidak urut alfabet.
:foreach ext in={".backup";".rsc"} do={
  :local files [/file find where name~"^nextmon-" and name~($ext . "\$")]
  :local cnt [:len $files]
  :if ($cnt>7) do={
    :local del ($cnt-7)
    :local k 0
    :foreach f in=$files do={
      :if ($k<$del) do={ /file remove $f }
      :set k ($k+1)
    }
  }
}
:log info ("nextmon-backup selesai: " . $base)
# Opsional upload (aktifkan setelah mengisi). UNVERIFIED
# /tool fetch upload=yes mode=sftp src-path=($base . ".backup") dst-path=("/backup/" . $base . ".backup") address=BACKUP_HOST user=BACKUP_USER password=BACKUP_PASS
}
/system scheduler remove [find name="nextmon-backup"]
/system scheduler add name="nextmon-backup" interval=1d start-time=03:00:00 on-event="/system script run nextmon-backup" policy=read,write,policy,test,ftp,sensitive comment="nextmon"
