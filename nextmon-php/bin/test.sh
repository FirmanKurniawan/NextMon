#!/bin/sh
# Runs unit tests, the HTTP smoke test and the adversarial security + tenant-isolation checks. Needs only `php` on PATH.
cd "$(dirname "$0")/.." || exit 1
php tests/run.php "$@" || exit 1
php tests/smoke.php || exit 1
php tests/security_http.php || exit 1
php tests/tenant_isolation_test.php || exit 1
php tests/perf_http.php
