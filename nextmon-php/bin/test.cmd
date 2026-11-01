@echo off
rem Runs unit tests, the HTTP smoke test and the adversarial security + tenant-isolation checks. Needs only php.exe on PATH.
cd /d "%~dp0.."
php tests\run.php %* || exit /b 1
php tests\smoke.php || exit /b 1
php tests\security_http.php || exit /b 1
php tests	enant_isolation_test.php || exit /b 1
php tests\perf_http.php
