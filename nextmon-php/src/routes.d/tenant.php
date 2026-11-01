<?php
/** Multi-tenant core: platform admin (accounts, switch) and router sharing. */
return [
    'POST /platform/switch' => ['WorkspaceSwitchController', 'switchTo', 'platform'],
    'GET /platform/accounts' => ['PlatformController', 'accounts', 'platform'],
    'POST /platform/accounts/create' => ['PlatformController', 'create', 'platform'],
    'POST /platform/accounts/status' => ['PlatformController', 'status', 'platform'],
    'POST /platform/accounts/limits' => ['PlatformController', 'limits', 'platform'],
    'POST /platform/accounts/reset' => ['PlatformController', 'reset', 'platform'],
    'POST /platform/accounts/delete' => ['PlatformController', 'delete', 'platform'],
    // router sharing (owner: admin; the recipient may also drop what it received)
    'POST /routers/share' => ['RoutersController', 'share', 'admin'],
    'POST /routers/share/revoke' => ['RoutersController', 'unshare', 'admin'],
];
