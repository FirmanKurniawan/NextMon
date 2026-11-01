<?php
/** Security module: password policy, idle timeout, sessions, login history. */
return [
    'GET /settings/security' => ['SecurityController', 'index', 'view'],
    'POST /security/policy' => ['SecurityController', 'savePolicy', 'admin'],
    'POST /security/sessions/revoke' => ['SecurityController', 'revokeSession', 'view'],
    'POST /security/sessions/revoke-others' => ['SecurityController', 'revokeOthers', 'view'],
];
