# ============================================================================
# 05 - Alert stok voucher rendah (tiap 6 jam). Membutuhkan script nextmon-tg dari 04.
# UNVERIFIED: belum diuji. Policy: read,write,test,policy
# Stok = user hotspot per profile yang belum pernah dipakai (uptime=0s) dan tidak disabled.
# ============================================================================
/system script remove [find name="nextmon-stock"]
/system script add name="nextmon-stock" policy=read,write,test,policy source={
:local threshold 20
:local profiles {"paket-1jam";"paket-1hari";"paket-7hari";"paket-30hari"}
:local msg ""
:foreach p in=$profiles do={
  :local n [:len [/ip hotspot user find where profile=$p uptime=0s disabled=no]]
  :if ($n<$threshold) do={ :set msg ($msg . $p . ":" . $n . " ") }
}
:if ([:len $msg]>0) do={
  :global kltgmsg ("[NextMON] Stok voucher rendah di " . [/system identity get name] . " -> " . $msg)
  /system script run nextmon-tg
}
}
/system scheduler remove [find name="nextmon-stock"]
/system scheduler add name="nextmon-stock" interval=6h start-time=startup on-event="/system script run nextmon-stock" policy=read,write,test,policy comment="nextmon"
