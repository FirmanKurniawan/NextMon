<?php
class DashboardController
{
    public static function index(): void
    {
        if (!App::routers()) {
            throw new RouterOSException('No router configured');   // empty account: the welcome card (App::routerError), not a dead dashboard
        }
        App::render('dashboard', [
            'title' => t('Dashboard'),
            'page' => 'dashboard',
            'live' => (bool)Store::setting('live_report', true),
            'appLog' => Audit::tail(8),
        ]);
    }

    /** Payload younger than this is served without touching the router at all (seconds). */
    private const FRESH = 2.5;
    /** Older than FRESH but younger than this: serve it now and refresh after the response is delivered (stale-while-revalidate). */
    private const STALE = 90.0;

    /**
     * /json/dashboard + /api/v1/status through a short shared cache: several tabs / pollers cost one router round-trip per
     * FRESH window, and a slightly stale payload is answered instantly while a refresh runs after the response.
     * Any write through the router driver bumps the router generation, which makes the cached payload unusable at once.
     */
    public static function cachedData(Driver $r, string $rid): array
    {
        if ($r->isDemo() || App::tuning('router_cache', 'NEXTMON_RCACHE', 1) === 0) {
            return self::data($r, $rid);   // demo data is live-jittered local state: nothing to save
        }
        $key = 'dash:' . $rid;
        $gen = Cache::gen(CachedDriver::nsFor($rid));
        $hit = Cache::get($key);
        if (is_array($hit) && ($hit['gen'] ?? null) === $gen) {
            $age = microtime(true) - (float)$hit['t'];
            if ($age < self::FRESH) {
                return $hit['d'];
            }
            if ($age < self::STALE && Cache::get('dashlock:' . $rid) === null) {
                Cache::set('dashlock:' . $rid, 1, 20);
                App::defer(function () use ($r, $rid, $key) {
                    try {
                        self::refresh($r, $rid, $key);
                    } finally {
                        Cache::delete('dashlock:' . $rid);
                    }
                });
                return $hit['d'];
            }
        }
        return self::refresh($r, $rid, $key);
    }

    private static function refresh(Driver $r, string $rid, string $key): array
    {
        $gen = Cache::gen(CachedDriver::nsFor($rid));   // read BEFORE fetching: a write that lands meanwhile makes this entry unusable
        $d = self::data($r, $rid);
        Cache::set($key, ['gen' => $gen, 't' => microtime(true), 'd' => $d], (int)self::STALE + 30);
        return $d;
    }

    /** Data for /json/dashboard and /api/v1/status */
    public static function data(Driver $r, string $rid): array
    {
        // every independent read in ONE round-trip (cached ones are answered locally); the user list serves both the
        // count and the per-profile breakdown, and the sales script list only travels when its own cache is cold
        $reqs = [
            'res' => ['/system/resource'],
            'idn' => ['/system/identity'],
            'act' => ['/ip/hotspot/active', [], ['user']],
            'usr' => ['/ip/hotspot/user', [], ['name', 'profile']],
            'if' => ['/interface', [], ['name', 'type']],
        ];
        $sales = Sales::cached($rid, null);
        if ($sales === null) {
            $reqs['sales'] = Sales::request(null);
        }
        $got = Pipe::prints($r, $reqs);
        if ($sales === null) {
            $sales = Sales::ingest($got['sales'], $rid, null);
        }
        $res = $got['res'][0] ?? [];
        $identity = $got['idn'][0]['name'] ?? '';
        $active = count($got['act']);
        $users = count($got['usr']);
        $today = Sales::filter($sales, 'day', date('Y-m-d'));
        $month = Sales::filter($sales, 'month', date('Y-m'));
        $daily = Sales::daily(Sales::filter($sales, 'all', ''));
        $spark = [];
        $labels = [];
        for ($i = 13; $i >= 0; $i--) {
            $k = date('Y-m-d', strtotime("-$i day"));
            $spark[] = (float)($daily[$k] ?? 0);
            $labels[] = date('d/m', strtotime($k));
        }
        $all = Sales::filter($sales, 'all', '');
        $cnt = [];
        $heat = array_fill(0, 7, array_fill(0, 24, 0));   // [weekday 0=Mon][hour] => number of sales
        foreach ($all as $s) {
            $k = date('Y-m-d', $s['ts']);
            $cnt[$k] = ($cnt[$k] ?? 0) + 1;
            $heat[(int)date('N', $s['ts']) - 1][(int)date('G', $s['ts'])]++;
        }
        $sparkCount = [];
        for ($i = 13; $i >= 0; $i--) {
            $sparkCount[] = (int)($cnt[date('Y-m-d', strtotime("-$i day"))] ?? 0);
        }
        $yesterday = (float)($daily[date('Y-m-d', strtotime('-1 day'))] ?? 0);
        $byProfile = [];
        foreach ($got['usr'] as $u) {
            $p = (string)($u['profile'] ?? 'default');
            $byProfile[$p] = ($byProfile[$p] ?? 0) + 1;
        }
        arsort($byProfile);
        $profiles = [];
        foreach ($byProfile as $n => $c) {
            $profiles[] = ['name' => (string)$n, 'count' => $c];
        }
        $hddTotal = (float)($res['total-hdd-space'] ?? 0);
        $hddFree = (float)($res['free-hdd-space'] ?? 0);
        $recent = array_map(fn($s) => ['time' => date('d/m H:i', $s['ts']), 'user' => $s['user'], 'profile' => $s['profile'], 'price' => $s['price']], array_slice($sales, 0, 6));
        $ifaces = array_column($got['if'], 'name');
        $total = (float)($res['total-memory'] ?? 0);
        $free = (float)($res['free-memory'] ?? 0);
        return [
            'ok' => true,
            'demo' => $r->isDemo(),
            'identity' => $identity,
            'resource' => [
                'cpu' => (int)($res['cpu-load'] ?? 0),
                'mem_pct' => $total > 0 ? (int)round(100 * ($total - $free) / $total) : 0,
                'mem_used' => fmt_bytes($total - $free),
                'mem_total' => fmt_bytes($total),
                'uptime' => $res['uptime'] ?? '',
                'version' => $res['version'] ?? '',
                'board' => $res['board-name'] ?? '',
                'disk_pct' => $hddTotal > 0 ? (int)round(100 * ($hddTotal - $hddFree) / $hddTotal) : 0,
                'disk_used' => fmt_bytes($hddTotal - $hddFree),
                'disk_total' => fmt_bytes($hddTotal),
            ],
            'spark_count' => $sparkCount,
            'yesterday' => $yesterday,
            'profiles' => $profiles,
            'heat' => $heat,
            'active' => $active,
            'users' => $users,
            'income_today' => Sales::sum($today),
            'income_month' => Sales::sum($month),
            'count_today' => count($today),
            'count_month' => count($month),
            'spark' => $spark,
            'spark_labels' => $labels,
            'recent' => $recent,
            'interfaces' => $ifaces,
            'currency' => Store::setting('currency', 'Rp'),
        ];
    }
}
