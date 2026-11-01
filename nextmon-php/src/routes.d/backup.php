<?php
/** Workspace app-data backup / restore (owner only). */
return [
    'GET /backup/appdata' => ['BackupController', 'appExport', 'admin'],
    'GET /backup/safety' => ['BackupController', 'safetyDownload', 'admin'],
    'POST /backup/restore/preview' => ['BackupController', 'restorePreview', 'admin'],
    'POST /backup/restore/apply' => ['BackupController', 'restoreApply', 'admin'],
    'POST /backup/restore/cancel' => ['BackupController', 'restoreCancel', 'admin'],
];
