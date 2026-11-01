#!/bin/sh
# NextMON server for Linux / macOS / Termux with the speed settings: OPcache and (where supported) several php -S workers.
#   bin/serve.sh [port] [bind]        env: WORKERS=4 (default 4; php -S forks workers on Linux/macOS, NOT on Windows), NEXTMON_DEMO=1
# php -S workers share nothing but the disk: sessions (files), SQLite (WAL) and the data/cache files are all safe for that.
# For anything public use nginx/Apache + php-fpm instead (deploy/nginx.conf, deploy/apache.conf).
cd "$(dirname "$0")/.." || exit 1
PORT="${1:-8080}"
BIND="${2:-127.0.0.1}"
export PHP_CLI_SERVER_WORKERS="${WORKERS:-4}"
OPC=""
if php -r 'exit(extension_loaded("Zend OPcache") ? 0 : 1);'; then
  OPC="-d opcache.enable=1"
else
  OPC="-d zend_extension=opcache -d opcache.enable=1"
fi
# shellcheck disable=SC2086
exec php $OPC -d opcache.memory_consumption=128 -d opcache.interned_strings_buffer=16 -d opcache.max_accelerated_files=4000 \
  -d opcache.validate_timestamps=1 -d opcache.revalidate_freq=2 -d opcache.jit=off \
  -d realpath_cache_size=4096K -d realpath_cache_ttl=600 \
  -S "$BIND:$PORT" -t public public/index.php
