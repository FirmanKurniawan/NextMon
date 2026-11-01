<?php
return [
    'GET /monitor' => ['MonitorController', 'index', 'view'],
    'POST /monitor/save' => ['MonitorController', 'save', 'admin'],
    'POST /monitor/run' => ['MonitorController', 'run', 'write'],
    'POST /monitor/token' => ['MonitorController', 'token', 'admin'],
    'POST /monitor/test' => ['MonitorController', 'test', 'admin'],
    'POST /monitor/simulate' => ['MonitorController', 'simulate', 'admin'],
    'GET /monitor/backup' => ['MonitorController', 'backupDownload', 'admin'],
];
