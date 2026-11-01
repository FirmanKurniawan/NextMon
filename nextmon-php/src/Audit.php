<?php
/**
 * Append-only audit log, one per workspace (collection audit.log). Every entry carries the workspace and the actor; actions a platform
 * admin performs inside somebody else's workspace are marked via=platform.
 */
final class Audit
{
    public static function log(string $action, string $detail = ''): void
    {
        $ws = Workspace::idOrNull();
        $u = Auth::user();
        $name = $u['username'] ?? ($_SESSION['uid'] ?? '-') ?: '-';
        $row = [
            'ts' => time(),
            'workspace' => $ws ?? '',
            'user' => $name,
            'actor' => $name,
            'ip' => self::ip(),
            'router' => $_SESSION['router'] ?? '',
            'action' => $action,
            'detail' => mb_substr(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $detail), 0, 500),
        ];
        if ($ws !== null && App::$impersonating) {
            $row['via'] = 'platform';
        }
        if ($ws === null) {
            // no workspace in scope (login page, unknown public lookups): the platform log, never a tenant's
            Store::global('platform_audit')->append($row);
            return;
        }
        Store::appendLog('audit.log', $row);
    }

    public static function tail(int $n = 300): array
    {
        return Store::tailLog('audit.log', $n);
    }

    public static function ip(): string
    {
        return Net::clientIp(); // X-Forwarded-For honoured only from trusted proxies (see Net)
    }
}
