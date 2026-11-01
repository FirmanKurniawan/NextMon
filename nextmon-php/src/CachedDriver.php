<?php
/**
 * Read-through cache in front of a remote Driver (see App::driver()). Behaviour is identical to the wrapped driver except that
 * a few read-only prints are answered from a short-lived cache shared by all requests (APCu or data/cache):
 *
 *   - TTLs are short for live data (seconds) and longer for rarely changing config (profiles, identity)
 *   - ANY write through this wrapper (add / set / remove / non-read command) bumps the router's generation, which invalidates
 *     every cached read of that router at once, in every process, before the next read
 *   - entries remember the generation current when their fetch STARTED, so a read racing a write can never resurrect old data
 *   - payloads that carry voucher passwords are encrypted at rest
 * Disable with NEXTMON_RCACHE=0 (or setting router_cache = false).
 */
final class CachedDriver implements Driver
{
    /** path => ttl seconds */
    public const TTL = [
        '/system/resource' => 3,
        '/system/health' => 5,
        '/system/identity' => 300,
        '/ip/hotspot/active' => 3,
        '/ip/hotspot/host' => 4,
        '/ip/hotspot/user' => 8,
        '/ip/hotspot/user/profile' => 30,
        '/ip/hotspot' => 60,
        '/ip/hotspot/ip-binding' => 6,
        '/interface' => 20,
        '/queue/simple' => 6,
        '/log' => 4,
    ];
    /** command paths that never change router state (do not invalidate) */
    private const READONLY_CMD = ['monitor-traffic', 'ping', 'print', 'getall', 'torch', 'resolve', 'traceroute', 'bandwidth-test'];

    private Driver $inner;
    private string $ns;

    /**
     * $ownerWs = the workspace that OWNS the router (a router shared with another workspace uses the owner's namespace, so both sides
     * share entries and every write invalidates them for everybody). Default: the active workspace.
     */
    public function __construct(Driver $inner, string $routerId, ?string $ownerWs = null)
    {
        $this->inner = $inner;
        $this->ns = self::nsFor($routerId, $ownerWs);
    }

    /** Cache generation namespace of one router: rt:<owner workspace>:<router id>. */
    public static function nsFor(string $routerId, ?string $ownerWs = null): string
    {
        return 'rt:' . ($ownerWs ?? App::routerOwner($routerId)) . ':' . $routerId;
    }

    public function inner(): Driver
    {
        return $this->inner;
    }

    public function isDemo(): bool
    {
        return $this->inner->isDemo();
    }

    public function setTimeout(int $s): void
    {
        if (method_exists($this->inner, 'setTimeout')) {
            $this->inner->setTimeout($s);
        }
    }

    public function close(): void
    {
        if (method_exists($this->inner, 'close')) {
            $this->inner->close();
        }
    }

    /** Invalidate all cached reads of this router (also callable from code that wrote to the router by other means). */
    public static function flush(string $routerId, ?string $ownerWs = null): void
    {
        Cache::bump(self::nsFor($routerId, $ownerWs));
    }

    private static function norm(string $p): string
    {
        return '/' . trim(str_replace(' ', '/', $p), '/');
    }

    private function key(string $path, array $query, array $props): string
    {
        return 'rd:' . $this->ns . ':' . hash('sha1', $path . '|' . json_encode($query) . '|' . json_encode($props));
    }

    private static function ttl(string $path): int
    {
        return self::TTL[$path] ?? 0;
    }

    public function print(string $path, array $query = [], array $props = []): array
    {
        $p = self::norm($path);
        $ttl = self::ttl($p);
        if ($ttl <= 0) {
            return $this->inner->print($path, $query, $props);
        }
        $gen = Cache::gen($this->ns);   // BEFORE the fetch
        $key = $this->key($p, $query, $props);
        $hit = Cache::get($key);
        if (is_array($hit) && ($hit[0] ?? null) === $gen) {
            return $hit[1];
        }
        $rows = $this->inner->print($path, $query, $props);
        Cache::set($key, [$gen, $rows], $ttl, $p === '/ip/hotspot/user');
        return $rows;
    }

    /** Pipelined prints; cached ones are answered locally and only the misses travel (together, in one round-trip). */
    public function printMany(array $reqs): array
    {
        $out = [];
        $miss = [];
        $gen = Cache::gen($this->ns);
        foreach ($reqs as $k => $q) {
            $p = self::norm((string)$q[0]);
            $ttl = self::ttl($p);
            if ($ttl > 0) {
                $hit = Cache::get($this->key($p, (array)($q[1] ?? []), (array)($q[2] ?? [])));
                if (is_array($hit) && ($hit[0] ?? null) === $gen) {
                    $out[$k] = $hit[1];
                    continue;
                }
            }
            $miss[$k] = $q;
        }
        if ($miss) {
            $got = count($miss) > 1 && method_exists($this->inner, 'printMany')
                ? $this->inner->printMany($miss)
                : array_map(fn($q) => $this->inner->print((string)$q[0], (array)($q[1] ?? []), (array)($q[2] ?? [])), $miss);
            foreach ($got as $k => $rows) {
                $q = $miss[$k];
                $p = self::norm((string)$q[0]);
                $ttl = self::ttl($p);
                if ($ttl > 0) {
                    Cache::set($this->key($p, (array)($q[1] ?? []), (array)($q[2] ?? [])), [$gen, $rows], $ttl, $p === '/ip/hotspot/user');
                }
                $out[$k] = $rows;
            }
        }
        // keep the caller's key order
        $ordered = [];
        foreach (array_keys($reqs) as $k) {
            $ordered[$k] = $out[$k];
        }
        return $ordered;
    }

    public function add(string $path, array $attrs): string
    {
        try {
            return $this->inner->add($path, $attrs);
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function set(string $path, string $id, array $attrs): void
    {
        try {
            $this->inner->set($path, $id, $attrs);
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function remove(string $path, string $id): void
    {
        try {
            $this->inner->remove($path, $id);
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function command(string $path, array $attrs = [], array $query = []): array
    {
        $last = substr(self::norm($path), strrpos(self::norm($path), '/') + 1);
        if (in_array($last, self::READONLY_CMD, true)) {
            return $this->inner->command($path, $attrs, $query);
        }
        try {
            return $this->inner->command($path, $attrs, $query);
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function addMany(string $path, array $rows): array
    {
        try {
            return method_exists($this->inner, 'addMany') ? $this->inner->addMany($path, $rows) : array_map(fn($a) => $this->inner->add($path, $a), $rows);
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function removeMany(string $path, array $ids): void
    {
        try {
            if (method_exists($this->inner, 'removeMany')) {
                $this->inner->removeMany($path, $ids);
            } else {
                foreach ($ids as $id) {
                    $this->inner->remove($path, $id);
                }
            }
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function addTry(string $path, array $rows): array
    {
        try {
            if (method_exists($this->inner, 'addTry')) {
                return $this->inner->addTry($path, $rows);
            }
            $out = [];
            foreach ($rows as $a) {
                try {
                    $out[] = ['id' => $this->inner->add($path, $a), 'err' => null];
                } catch (RouterOSException $e) {
                    $out[] = ['id' => '', 'err' => $e->getMessage()];
                }
            }
            return $out;
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function setTry(string $path, array $changes): array
    {
        try {
            if (method_exists($this->inner, 'setTry')) {
                return $this->inner->setTry($path, $changes);
            }
            $out = [];
            foreach ($changes as $c) {
                try {
                    $this->inner->set($path, (string)$c[0], (array)$c[1]);
                    $out[] = ['err' => null];
                } catch (RouterOSException $e) {
                    $out[] = ['err' => $e->getMessage()];
                }
            }
            return $out;
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function commandMany(string $path, array $attrList): void
    {
        try {
            if (method_exists($this->inner, 'commandMany')) {
                $this->inner->commandMany($path, $attrList);
            } else {
                foreach ($attrList as $a) {
                    $this->inner->command($path, $a);
                }
            }
        } finally {
            Cache::bump($this->ns);
        }
    }

    public function setMany(string $path, array $changes): void
    {
        try {
            if (method_exists($this->inner, 'setMany')) {
                $this->inner->setMany($path, $changes);
            } else {
                foreach ($changes as $id => $a) {
                    $this->inner->set($path, (string)$id, $a);
                }
            }
        } finally {
            Cache::bump($this->ns);
        }
    }
}
