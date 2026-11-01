# ============================================================================
# 07 - Group & user API khusus NextMON (least privilege)
# VERIFIED (sintaks): /user group add name= policy= ; /user add name= group= address= password=
# Tanpa winbox/ssh/telnet/web/ftp/reboot/password/sniff.
# Ganti SERVER_IP dan PASSWORD_ACAK (>=24 karakter acak).
# ============================================================================
/user group remove [find name="nextmon-op"]
/user group add name=nextmon-op policy=read,write,api,test,policy comment="NextMON operator (voucher, profile on-login)"
/user group remove [find name="nextmon-ro"]
/user group add name=nextmon-ro policy=read,api comment="NextMON read-only (dashboard, monitor)"
# Backup/wizard (opsional, jangan dipakai harian):
# /user group add name=nextmon-admin policy=read,write,api,test,policy,ftp,sensitive

/user remove [find name="nextmon"]
/user add name=nextmon group=nextmon-op address=SERVER_IP/32 password="PASSWORD_ACAK" comment="NextMON API"
# User read-only:
# /user add name=nextmon-ro group=nextmon-ro address=SERVER_IP/32 password="PASSWORD_ACAK2"

# CATATAN: policy "policy" sensitif (dapat mengubah user/group); hapus bila tidak perlu mengelola on-login profile.
# UNVERIFIED: apakah mengubah on-login profile cukup dengan "write" tanpa "policy" -> uji; Mikhmon memakai user admin penuh.
