# ============================================================================
# 06 - Aktifkan API / API-SSL, batasi sumber
# VERIFIED (sintaks umum): /ip service set ... ; /certificate add / sign
# UNVERIFIED: detail penandatanganan sertifikat per versi (v6 vs v7); penandatanganan bisa lama di hardware kecil.
# Ganti 192.168.88.0/24 dengan IP/subnet server NextMON.
# ============================================================================
/ip service set api disabled=no port=8728 address=192.168.88.0/24

# API-SSL (disarankan bila NextMON tidak satu LAN):
/certificate add name=nextmon-ca common-name=nextmon-ca days-valid=3650 key-usage=key-cert-sign,crl-sign
/certificate sign nextmon-ca
/certificate add name=nextmon-api common-name=nextmon-api days-valid=3650
/certificate sign nextmon-api ca=nextmon-ca
/ip service set api-ssl disabled=no port=8729 certificate=nextmon-api address=192.168.88.0/24

# Matikan layanan tak perlu (opsional; periksa dulu agar tidak mengunci diri):
# /ip service set telnet disabled=yes
# /ip service set ftp disabled=yes
