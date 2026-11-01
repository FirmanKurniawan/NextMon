<?php
/**
 * Driver decorator for routers shared READ-ONLY (Share mode `ro`): reads pass through, every write throws RouterOSException before
 * anything reaches the router. Enforced centrally in App::driver() / App::driverFor(), so no controller can forget the check.
 * Commands are allowed only when they are known to be read-only (monitor-traffic, ping, print, ...).
 */
final class ReadOnlyDriver implements Driver
{
    private const READONLY_CMD = ['monitor-traffic', 'ping', 'print', 'getall', 'torch', 'resolve', 'traceroute', 'bandwidth-test', 'export'];

    private Driver $inner;

    public function __construct(Driver $inner)
    {
        $this->inner = $inner;
    }

    public function inner(): Driver
    {
        return $this->inner;
    }

    private static function deny(): RouterOSException
    {
        return new RouterOSException('This router is shared with you as read-only.');
    }

    public function isDemo(): bool
    {
        return $this->inner->isDemo();
    }

    public function print(string $path, array $query = [], array $props = []): array
    {
        return $this->inner->print($path, $query, $props);
    }

    /** Pipelined reads (Pipe::prints uses method_exists). */
    public function printMany(array $reqs): array
    {
        if (method_exists($this->inner, 'printMany')) {
            return $this->inner->printMany($reqs);
        }
        $out = [];
        foreach ($reqs as $k => $q) {
            $out[$k] = $this->inner->print((string)$q[0], (array)($q[1] ?? []), (array)($q[2] ?? []));
        }
        return $out;
    }

    public function add(string $path, array $attrs): string
    {
        throw self::deny();
    }

    public function set(string $path, string $id, array $attrs): void
    {
        throw self::deny();
    }

    public function remove(string $path, string $id): void
    {
        throw self::deny();
    }

    public function command(string $path, array $attrs = [], array $query = []): array
    {
        $p = '/' . trim(str_replace(' ', '/', $path), '/');
        $last = substr($p, (int)strrpos($p, '/') + 1);
        if (!in_array($last, self::READONLY_CMD, true) || ($last === 'export' && isset($attrs['file']))) {
            throw self::deny();
        }
        return $this->inner->command($path, $attrs, $query);
    }

    // the pipelined / bulk write helpers exist so callers that probe with method_exists get a clear refusal instead of a fatal error
    public function addMany(string $path, array $rows): array
    {
        throw self::deny();
    }

    public function removeMany(string $path, array $ids): void
    {
        throw self::deny();
    }

    public function addTry(string $path, array $rows): array
    {
        throw self::deny();
    }

    public function setTry(string $path, array $changes): array
    {
        throw self::deny();
    }

    public function commandMany(string $path, array $attrList): void
    {
        throw self::deny();
    }

    public function setMany(string $path, array $changes): void
    {
        throw self::deny();
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
}
