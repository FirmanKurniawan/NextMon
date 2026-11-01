# ============================================================================
# 08 - Walled garden default (akses tanpa login)
# VERIFIED (sintaks): /ip hotspot walled-garden add dst-host= ; /ip hotspot walled-garden ip add
# Sesuaikan: domain payment gateway & server NextMON (portal self-service).
# ============================================================================
/ip hotspot walled-garden remove [find comment="nextmon"]
# Portal & pembayaran
/ip hotspot walled-garden add dst-host=NEXTMON.DOMAINMU.COM comment="nextmon"
/ip hotspot walled-garden add dst-host=*.midtrans.com comment="nextmon"
/ip hotspot walled-garden add dst-host=*.xendit.co comment="nextmon"
/ip hotspot walled-garden add dst-host=*.tripay.co.id comment="nextmon"
# Deteksi captive portal OS (opsional)
/ip hotspot walled-garden add dst-host=captive.apple.com comment="nextmon"
/ip hotspot walled-garden add dst-host=connectivitycheck.gstatic.com comment="nextmon"
# Walled garden IP (server NextMON):
# /ip hotspot walled-garden ip add dst-address=SERVER_IP action=accept comment="nextmon"
# UNVERIFIED: daftar host gateway pembayaran lengkap (CDN/JS) bervariasi; uji alur bayar dan tambahkan host yang
# terblokir berdasarkan /log.
