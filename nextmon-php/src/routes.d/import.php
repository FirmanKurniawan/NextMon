<?php
/** Hotspot users CSV import / export */
return [
    'GET /import' => ['ImportController', 'index', 'write'],
    'GET /import/template' => ['ImportController', 'template', 'write'],
    'GET /import/export' => ['ImportController', 'export', 'write'],
    'POST /import/preview' => ['ImportController', 'preview', 'write'],
    'GET /import/preview' => ['ImportController', 'previewPage', 'write'],
    'POST /import/commit' => ['ImportController', 'commit', 'write'],
    'POST /import/cancel' => ['ImportController', 'cancel', 'write'],
    'GET /import/result' => ['ImportController', 'result', 'write'],
    'GET /import/errors' => ['ImportController', 'errors', 'write'],
];
