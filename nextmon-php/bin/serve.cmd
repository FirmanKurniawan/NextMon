@echo off
rem NextMON server with OPcache + realpath cache (see bin\serve.ps1). Usage: bin\serve.cmd [-Port 8080] [-Demo] [-NoOpcache]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
