# NextMON dev/home server with the speed settings that matter on Windows.
#   .\bin\serve.ps1 [-Port 8080] [-Bind localhost] [-Demo] [-NoOpcache]
# What it adds over a bare `php -S`:
#   - OPcache on (php_opcache.dll ships with the Windows build but is disabled by default): PHP-side time per page drops ~3-4x
#     (measured: /settings 21 ms -> 6 ms). validate_timestamps stays on, so editing source still works (re-checked every 2 s).
#   - bigger realpath cache (Windows stat() is slow), JIT off (no gain for this workload, more memory).
# `php -S` is SINGLE-THREADED and PHP_CLI_SERVER_WORKERS is not supported on Windows: one slow request blocks all others.
# NextMON compensates (pooled router connection, pipelining, short caches) but for more than one user use XAMPP/Apache,
# nginx + php-cgi/php-fpm or Caddy + php-cgi (see README "Performa & deployment").
param([int]$Port = 8080, [string]$Bind = 'localhost', [switch]$Demo, [switch]$NoOpcache)
$php = (Get-Command php -ErrorAction SilentlyContinue).Source
if (-not $php) {
  $php = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter php.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $php) { Write-Host "PHP tidak ditemukan. Pasang: winget install PHP.PHP.8.4" -ForegroundColor Red; exit 1 }
if ($Demo) { $env:NEXTMON_DEMO = "1"; Write-Host "MODE DEMO: semua router disimulasikan" -ForegroundColor Yellow } else { Remove-Item Env:NEXTMON_DEMO -ErrorAction SilentlyContinue }

$phpArgs = @()
if (-not $NoOpcache) {
  $loaded = (& $php -r "echo extension_loaded('Zend OPcache') ? '1' : '0';")
  $dll = Join-Path (Split-Path $php) 'ext\php_opcache.dll'
  if ($loaded -ne '1' -and (Test-Path $dll)) { $phpArgs += @('-d', 'zend_extension=opcache') }
  if ($loaded -eq '1' -or (Test-Path $dll)) {
    $phpArgs += @('-d', 'opcache.enable=1', '-d', 'opcache.memory_consumption=128', '-d', 'opcache.interned_strings_buffer=16',
               '-d', 'opcache.max_accelerated_files=4000', '-d', 'opcache.validate_timestamps=1', '-d', 'opcache.revalidate_freq=2',
               '-d', 'opcache.jit=off')
    Write-Host "OPcache: aktif" -ForegroundColor Green
  } else {
    Write-Host "OPcache tidak ditemukan di build PHP ini - jalan tanpa OPcache (lebih lambat)." -ForegroundColor Yellow
  }
}
$phpArgs += @('-d', 'realpath_cache_size=4096K', '-d', 'realpath_cache_ttl=600')
$pub = Join-Path (Split-Path $PSScriptRoot) 'public'
Write-Host "PHP: $php`nBuka http://${Bind}:$Port   (php -S = satu thread; untuk banyak pengguna pakai XAMPP/nginx, lihat README)" -ForegroundColor Cyan
& $php @phpArgs -S "${Bind}:$Port" -t $pub (Join-Path $pub 'index.php')
