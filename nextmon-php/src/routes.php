<?php
/** "METHOD /path" => [Controller class, static method, required capability] */
return [
    // public
    'GET /setup' => ['AuthController', 'setupForm', 'view'],
    'POST /setup' => ['AuthController', 'setup', 'view'],
    'GET /login' => ['AuthController', 'loginForm', 'view'],
    'POST /login' => ['AuthController', 'login', 'view'],
    'POST /logout' => ['AuthController', 'logout', 'view'],
    'GET /lang' => ['AuthController', 'lang', 'view'],
    'GET /status' => ['StatusController', 'page', 'view'],
    'GET /status.json' => ['StatusController', 'json', 'view'],
    'GET /manifest.webmanifest' => ['StatusController', 'manifest', 'view'],
    'GET /sw.js' => ['StatusController', 'sw', 'view'],
    'GET /offline' => ['StatusController', 'offline', 'view'],

    'GET /' => ['DashboardController', 'index', 'view'],

    'GET /routers' => ['RoutersController', 'index', 'view'],
    'POST /routers/save' => ['RoutersController', 'save', 'admin'],
    'POST /routers/delete' => ['RoutersController', 'delete', 'admin'],
    'POST /routers/select' => ['RoutersController', 'select', 'view'],
    'POST /routers/test' => ['RoutersController', 'test', 'admin'],

    'GET /hotspot/users' => ['HotspotController', 'users', 'view'],
    'POST /hotspot/users/save' => ['HotspotController', 'userSave', 'write'],
    'POST /hotspot/users/action' => ['HotspotController', 'userAction', 'write'],
    'GET /hotspot/profiles' => ['HotspotController', 'profiles', 'view'],
    'POST /hotspot/profiles/save' => ['HotspotController', 'profileSave', 'write'],
    'POST /hotspot/profiles/delete' => ['HotspotController', 'profileDelete', 'write'],
    'POST /hotspot/profiles/preview' => ['HotspotController', 'profilePreview', 'view'],
    'GET /hotspot/active' => ['HotspotController', 'active', 'view'],
    'POST /hotspot/active/kick' => ['HotspotController', 'activeKick', 'write'],
    'GET /hotspot/hosts' => ['HotspotController', 'hosts', 'view'],
    'POST /hotspot/hosts/remove' => ['HotspotController', 'hostRemove', 'write'],
    'GET /hotspot/bindings' => ['HotspotController', 'bindings', 'view'],
    'POST /hotspot/bindings/save' => ['HotspotController', 'bindingSave', 'write'],
    'POST /hotspot/bindings/action' => ['HotspotController', 'bindingAction', 'write'],

    'GET /vouchers' => ['VoucherController', 'index', 'sell'],
    'POST /vouchers/generate' => ['VoucherController', 'generate', 'sell'],
    'POST /vouchers/delete' => ['VoucherController', 'deleteBatch', 'write'],
    'GET /vouchers/print' => ['VoucherController', 'printView', 'sell'],
    'GET /vouchers/templates' => ['VoucherController', 'templates', 'write'],
    'POST /vouchers/templates/save' => ['VoucherController', 'templateSave', 'write'],
    'POST /vouchers/templates/delete' => ['VoucherController', 'templateDelete', 'write'],

    'GET /reports' => ['ReportController', 'index', 'view'],
    'GET /reports/export' => ['ReportController', 'export', 'view'],
    'POST /reports/delete' => ['ReportController', 'delete', 'admin'],

    'GET /pos' => ['PosController', 'index', 'sell'],
    'POST /pos/sell' => ['PosController', 'sell', 'sell'],

    'GET /tools' => ['ToolsController', 'index', 'view'],
    'POST /tools/run' => ['ToolsController', 'run', 'view'],

    'GET /backup' => ['BackupController', 'index', 'write'],
    'POST /backup/create' => ['BackupController', 'create', 'write'],
    'GET /backup/download' => ['BackupController', 'download', 'write'],

    'GET /queues' => ['NetController', 'queues', 'view'],
    'POST /queues/save' => ['NetController', 'queueSave', 'write'],
    'POST /queues/action' => ['NetController', 'queueAction', 'write'],
    'GET /firewall' => ['NetController', 'firewall', 'view'],
    'POST /firewall/add' => ['NetController', 'firewallAdd', 'write'],
    'POST /firewall/remove' => ['NetController', 'firewallRemove', 'write'],
    'POST /firewall/rule' => ['NetController', 'firewallRule', 'admin'],

    'GET /settings' => ['SettingsController', 'index', 'view'],
    'POST /settings/save' => ['SettingsController', 'save', 'admin'],
    'POST /settings/password' => ['SettingsController', 'password', 'view'],
    'POST /settings/user' => ['SettingsController', 'userSave', 'admin'],
    'POST /settings/user-delete' => ['SettingsController', 'userDelete', 'admin'],
    'POST /settings/key' => ['SettingsController', 'keyCreate', 'admin'],
    'POST /settings/key-delete' => ['SettingsController', 'keyDelete', 'admin'],

    'GET /audit' => ['SettingsController', 'audit', 'admin'],
    'GET /notifications' => ['SettingsController', 'notifications', 'admin'],
    'POST /notifications/save' => ['SettingsController', 'notificationsSave', 'admin'],
    'POST /notifications/test' => ['SettingsController', 'notificationsTest', 'admin'],
];
