<?php
/**
 * JSON endpoints.
 *   /json/*      session-authenticated, used by the UI (polling)
 *   /api/v1/*    API-key authenticated (header X-API-Key or "Authorization: Bearer"), for integrations
 */
class ApiController
{
    public static function handle(string $path, string $method): void
    {
        $viaKey = strncmp($path, '/api/v1/', 8) === 0;
        $name = $viaKey ? substr($path, 8) : (strncmp($path, '/json/', 6) === 0 ? substr($path, 6) : '');
        if ($name === '') {
            App::json(['ok' => false, 'error' => 'not found'], 404);
        }
        $write = false;
        if ($viaKey) {
            $key = self::key();
            if (!$key) {
                // throttle guessing; keys are 160-bit random so this is mostly about log/CPU noise
                if (Net::hit('apifail', Audit::ip(), 30, 600)) {
                    header('Retry-After: 600');
                    App::json(['ok' => false, 'error' => 'too many attempts'], 429);
                }
                App::json(['ok' => false, 'error' => 'invalid api key'], 401);
            }
            if (Net::hit('apikey', (string)$key['id'], 600, 60)) { // 600 requests / minute / key
                header('Retry-After: 60');
                App::json(['ok' => false, 'error' => 'rate limited'], 429);
            }
            $write = ($key['scope'] ?? 'read') === 'write';
            $rid = App::get('router') ?: (App::routers()[0]['id'] ?? '');
            if (time() - (int)($key['last'] ?? 0) >= 60) { // "last used" is shown to the minute: do not rewrite the keys doc on every call
                Store::update('apikeys', function ($l) use ($key) {
                    foreach ($l as $i => $k) {
                        if ($k['id'] === $key['id']) {
                            $l[$i]['last'] = time();
                        }
                    }
                    return $l;
                }, []);
            }
        } else {
            if (!Auth::check()) {
                App::json(['ok' => false, 'error' => 'unauthenticated'], 401);
            }
            if ($method === 'POST' && !Auth::verifyCsrf()) {
                App::json(['ok' => false, 'error' => 'csrf'], 419);
            }
            $write = Auth::can('write');
            // ?router= may pick another router, but only one of THIS workspace's (own or shared with it): unknown id => 404 below
            $rid = App::get('router') !== '' ? App::get('router') : App::currentRouterId();
            if ($method === 'GET') {
                App::closeSession();   // polling XHRs are read-only: never hold the session lock while talking to the router
            }
        }
        if (!App::routerCfg($rid)) {
            App::json(['ok' => false, 'error' => 'unknown router'], 404);
        }
        $input = $method === 'POST' ? App::body() : $_GET;
        try {
            $r = App::driver($rid);
            $out = self::resource($name, $method, $r, $rid, $input, $write, $viaKey);
        } catch (RouterOSException $e) {
            App::json(['ok' => false, 'error' => $e->getMessage()], 502);
        }
        App::json($out, ($out['ok'] ?? true) ? 200 : 400);
    }

    private static function key(): ?array
    {
        $k = $_SERVER['HTTP_X_API_KEY'] ?? '';
        if ($k === '' && preg_match('/^Bearer\s+(\S+)/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) {
            $k = $m[1];
        }
        if ($k === '') {
            return null;
        }
        if (strlen($k) > 200) {
            return null;
        }
        $h = hash('sha256', $k);
        // the key itself tells us the tenant: global index (hash -> workspace), then the key must also exist in that workspace's own list
        $ws = Workspace::wsByKeyHash($h);
        if ($ws === null) {
            return null;
        }
        if (!Workspace::isActive($ws)) {
            App::json(['ok' => false, 'error' => 'workspace suspended'], 403);
        }
        Workspace::set($ws);
        App::$impersonating = false;
        App::applyLocale();
        $hit = null;
        foreach ((array)Store::read('apikeys', []) as $row) { // no early exit: same work whether or not (and where) a key matches
            if (hash_equals((string)$row['hash'], $h)) {
                $hit = $row;
            }
        }
        return $hit;
    }

    private static function resource(string $name, string $method, Driver $r, string $rid, array $in, bool $canWrite, bool $viaKey): array
    {
        $limit = max(1, min(1000, (int)($in['limit'] ?? 200)));
        switch ($name) {
            case 'dashboard':
            case 'status':
                return DashboardController::cachedData($r, $rid);
            case 'traffic':
                $if = preg_replace('/[^A-Za-z0-9_.\-]/', '', (string)($in['interface'] ?? 'ether1'));
                $row = $r->command('/interface/monitor-traffic', ['interface' => $if, 'once' => true])[0] ?? [];
                return ['ok' => true, 't' => time(), 'rx' => (int)($row['rx-bits-per-second'] ?? 0), 'tx' => (int)($row['tx-bits-per-second'] ?? 0)];
            case 'interfaces':
                return ['ok' => true, 'data' => $r->print('/interface', [], ['name', 'type', 'running'])];
            case 'health':
                $g = Pipe::prints($r, ['res' => ['/system/resource'], 'health' => ['/system/health']]);
                return ['ok' => true, 'resource' => $g['res'][0] ?? [], 'health' => $g['health'][0] ?? []];
            case 'logs':
                $rows = array_filter($r->print('/log', [], ['time', 'topics', 'message']), fn($x) => stripos($x['topics'] ?? '', 'hotspot') !== false);
                return ['ok' => true, 'data' => array_slice(array_reverse(array_values($rows)), 0, 20)];
            case 'users':
                $q = strtolower((string)($in['q'] ?? ''));
                $rows = $r->print('/ip/hotspot/user', isset($in['profile']) && $in['profile'] !== '' ? ['profile' => (string)$in['profile']] : [], ['name', 'profile', 'comment', 'uptime', 'bytes-in', 'bytes-out', 'limit-uptime', 'disabled']);
                if ($q !== '') {
                    $rows = array_values(array_filter($rows, fn($x) => strpos(strtolower(($x['name'] ?? '') . ' ' . ($x['comment'] ?? '')), $q) !== false));
                }
                return ['ok' => true, 'total' => count($rows), 'data' => array_slice($rows, 0, $limit)];
            case 'profiles':
                $rows = $r->print('/ip/hotspot/user/profile', [], ['name', 'rate-limit', 'shared-users', 'on-login']);
                foreach ($rows as &$p) {
                    $p['meta'] = Scripts::parseMeta($p['on-login'] ?? '');
                    unset($p['on-login']);
                }
                return ['ok' => true, 'data' => $rows];
            case 'active':
                return ['ok' => true, 'data' => $r->print('/ip/hotspot/active')];
            case 'hosts':
                return ['ok' => true, 'data' => $r->print('/ip/hotspot/host')];
            case 'sales':
                $all = Sales::fetch($r, $rid);
                $period = (string)($in['period'] ?? 'month');
                $val = (string)($in['value'] ?? ['day' => date('Y-m-d'), 'month' => date('Y-m'), 'year' => date('Y'), 'all' => ''][$period] ?? '');
                $rows = Sales::filter($all, $period, $val, (string)($in['profile'] ?? ''));
                return ['ok' => true, 'total' => Sales::sum($rows), 'count' => count($rows), 'data' => array_slice($rows, 0, $limit)];
            case 'vouchers':
                if ($method !== 'POST') {
                    return ['ok' => false, 'error' => 'POST required'];
                }
                if (!$canWrite) {
                    return ['ok' => false, 'error' => 'forbidden: key scope is read-only'];
                }
                if (empty($in['profile'])) {
                    return ['ok' => false, 'error' => 'profile required'];
                }
                $res = Voucher::generate($r, [
                    'profile' => (string)$in['profile'], 'qty' => (int)($in['qty'] ?? 1), 'prefix' => (string)($in['prefix'] ?? ''),
                    'length' => (int)($in['length'] ?? 6), 'charset' => (string)($in['charset'] ?? 'lowernum'), 'mode' => (string)($in['mode'] ?? 'vc'),
                    'batch' => (string)($in['batch'] ?? 'api'),
                ]);
                Audit::log($viaKey ? 'api.vouchers' : 'vouchers.generate', count($res['items']) . ' x ' . $in['profile']);
                return ['ok' => true, 'comment' => $res['comment'], 'data' => array_map(fn($i) => ['user' => $i[0], 'password' => $i[1]], $res['items'])];
            case 'kick':
                if ($method !== 'POST' || !$canWrite) {
                    return ['ok' => false, 'error' => 'POST + write scope required'];
                }
                $n = 0;
                foreach ($r->print('/ip/hotspot/active', ['user' => (string)($in['user'] ?? '')], ['user']) as $a) {
                    $r->remove('/ip/hotspot/active', $a['.id']);
                    $n++;
                }
                Audit::log($viaKey ? 'api.kick' : 'active.kick', (string)($in['user'] ?? ''));
                return ['ok' => true, 'kicked' => $n];
        }
        return ['ok' => false, 'error' => 'unknown resource'];
    }
}
