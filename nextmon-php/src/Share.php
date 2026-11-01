<?php
/**
 * Router sharing between workspaces. A share row (global doc `shares`):
 *   id, router (router id inside the owner's workspace), owner (workspace id), to (workspace id), mode ro|rw, created, by (username)
 * The recipient sees the router in App::routers() with shared=true / mode; the credentials never leave the owner's workspace
 * (App::driver() resolves them server-side). `ro` = every write through the driver is refused (ReadOnlyDriver).
 */
final class Share
{
    public const MODES = ['ro', 'rw'];

    /** @return array[] all share rows */
    public static function all(): array
    {
        return array_values((array)Store::global('shares')->read([]));
    }

    /** The share that gives the ACTIVE workspace access to $routerId (a router of another workspace), or null. */
    public static function for(string $routerId): ?array
    {
        $me = Workspace::idOrNull();
        if ($me === null) {
            return null;
        }
        foreach (self::all() as $s) {
            if ($s['router'] === $routerId && $s['to'] === $me && Workspace::isActive((string)$s['owner'])) {
                return $s;
            }
        }
        return null;
    }

    /** Shares the active workspace has RECEIVED. */
    public static function incoming(): array
    {
        $me = Workspace::id();
        return array_values(array_filter(self::all(), fn($s) => $s['to'] === $me && Workspace::isActive((string)$s['owner'])));
    }

    /** Shares the active workspace has GIVEN (optionally for one router). */
    public static function outgoing(string $routerId = ''): array
    {
        $me = Workspace::id();
        return array_values(array_filter(self::all(), fn($s) => $s['owner'] === $me && ($routerId === '' || $s['router'] === $routerId)));
    }

    /**
     * Share one of the ACTIVE workspace's routers with another workspace (re-sharing replaces the mode).
     * @throws InvalidArgumentException when the router is not yours, or the target is unknown / yourself. (A demo router can be shared too;
     * its simulated state lives in the owner's workspace. If the recipient has an own router with the same id, the own one wins.)
     */
    public static function grant(string $routerId, string $toWorkspace, string $mode = 'ro'): array
    {
        $me = Workspace::id();
        $mode = in_array($mode, self::MODES, true) ? $mode : 'ro';
        $r = null;
        foreach ((array)Store::read('routers', []) as $x) {
            if ($x['id'] === $routerId) {
                $r = $x;
            }
        }
        if (!$r) {
            throw new InvalidArgumentException('Router not found.');
        }
        $to = Workspace::resolveRef($toWorkspace);
        if (!$to || $to['id'] === $me) {
            throw new InvalidArgumentException('Unknown target workspace.');
        }
        $row = null;
        $u = Auth::user();
        Store::global('shares')->update(function ($list) use (&$row, $routerId, $me, $to, $mode, $u) {
            $list = array_values((array)$list);
            foreach ($list as $i => $s) {
                if ($s['router'] === $routerId && $s['owner'] === $me && $s['to'] === $to['id']) {
                    $list[$i]['mode'] = $mode;
                    $row = $list[$i];
                    return $list;
                }
            }
            $row = ['id' => bin2hex(random_bytes(4)), 'router' => $routerId, 'owner' => $me, 'to' => $to['id'], 'mode' => $mode, 'created' => time(), 'by' => $u['username'] ?? ''];
            $list[] = $row;
            return $list;
        }, []);
        Audit::log('share.grant', $routerId . ' -> ' . $to['slug'] . ' (' . $mode . ')');
        return $row;
    }

    /** Withdraw a share. The owner may revoke their own shares; a recipient may drop one it received. */
    public static function revoke(string $shareId): bool
    {
        $me = Workspace::id();
        $found = false;
        Store::global('shares')->update(function ($list) use ($shareId, $me, &$found) {
            $keep = [];
            foreach ((array)$list as $s) {
                if ($s['id'] === $shareId && ($s['owner'] === $me || $s['to'] === $me)) {
                    $found = true;
                    continue;
                }
                $keep[] = $s;
            }
            return $keep;
        }, []);
        if ($found) {
            Audit::log('share.revoke', $shareId);
        }
        return $found;
    }

    /** Drop every share of a router (called when the owner deletes it). */
    public static function dropRouter(string $routerId): void
    {
        $me = Workspace::id();
        Store::global('shares')->update(fn($l) => array_values(array_filter((array)$l, fn($s) => !($s['owner'] === $me && $s['router'] === $routerId))), []);
    }
}
