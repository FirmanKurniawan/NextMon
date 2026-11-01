# Menjalankan NextMON (PHP) dengan pengaturan cepat (OPcache). Pakai: .\start-php.ps1 [-Port 8080] [-Demo]
# Tanpa -Demo = router asli dipakai. Detail ada di nextmon-php\bin\serve.ps1
& (Join-Path $PSScriptRoot "nextmon-php\bin\serve.ps1") @args
