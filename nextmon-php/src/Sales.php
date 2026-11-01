<?php
/** Reads Mikhmon-compatible sales records from /system script. */
final class Sales
{
    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

    private static function cacheFile(string $routerId, ?string $owner): string
    {
        return Workspace::dir('cache') . '/sales-' . preg_replace('/\W/', '', $routerId) . '-' . ($owner ?: 'all') . '.json';
    }

    /** Parsed rows from the file cache, or null when missing / older than $ttl. */
    public static function cached(string $routerId, ?string $owner = null, int $ttl = 45): ?array
    {
        $cache = self::cacheFile($routerId, $owner);
        if ($ttl > 0 && is_file($cache) && time() - filemtime($cache) < $ttl) {
            $j = json_decode((string)file_get_contents($cache), true);
            if (is_array($j)) {
                return $j;
            }
        }
        return null;
    }

    /** The one print that Sales::fetch needs (so a caller can pipeline it with other reads). Only the record name is parsed. */
    public static function request(?string $owner = null): array
    {
        $q = ['comment' => 'mikhmon'];
        if ($owner) {
            $q['owner'] = $owner;
        }
        return ['/system/script', $q, ['name']];
    }

    /** Parse the raw script rows, store them in the cache, return the sales rows. */
    public static function ingest(array $scripts, string $routerId, ?string $owner = null): array
    {
        $rows = self::parse($scripts);
        @file_put_contents(self::cacheFile($routerId, $owner), json_encode($rows), LOCK_EX);
        return $rows;
    }

    /** Parsed sales rows, cached for $ttl seconds. Row ts = unix time of sale. */
    public static function fetch(Driver $r, string $routerId, ?string $owner = null, int $ttl = 45): array
    {
        $hit = self::cached($routerId, $owner, $ttl);
        if ($hit !== null) {
            return $hit;
        }
        [$path, $q, $props] = self::request($owner);
        return self::ingest($r->print($path, $q, $props), $routerId, $owner);
    }
    public static function flush(string $routerId): void
    {
        foreach (glob(Workspace::dir('cache') . '/sales-' . preg_replace('/\W/', '', $routerId) . '-*.json') ?: [] as $f) {   // tenant-ok: per-workspace cache dir
            @unlink($f);
        }
    }

    public static function parse(array $scripts): array
    {
        $out = [];
        foreach ($scripts as $s) {
            $p = explode('-|-', (string)($s['name'] ?? ''));
            if (count($p) < 8) {
                continue;
            }
            $ts = self::ts($p[0], $p[1]);
            $out[] = [
                'id' => $s['.id'] ?? '',
                'date' => $p[0],
                'time' => $p[1],
                'ts' => $ts,
                'user' => $p[2],
                'price' => (float)$p[3],
                'ip' => $p[4],
                'mac' => $p[5],
                'validity' => $p[6],
                'profile' => $p[7],
                'comment' => $p[8] ?? '',
            ];
        }
        usort($out, fn($a, $b) => $b['ts'] <=> $a['ts']);
        return $out;
    }

    /** "oct/12/2026" or "2026-10-12" + "hh:mm:ss" => unix ts */
    public static function ts(string $date, string $time): int
    {
        $y = $m = $d = 0;
        if (preg_match('~^([a-z]{3})/(\d{1,2})/(\d{4})$~i', $date, $x)) {
            $m = self::MONTHS[strtolower($x[1])] ?? 0;
            $d = (int)$x[2];
            $y = (int)$x[3];
        } elseif (preg_match('~^(\d{4})-(\d{2})-(\d{2})$~', $date, $x)) {
            $y = (int)$x[1];
            $m = (int)$x[2];
            $d = (int)$x[3];
        }
        if (!$m) {
            return 0;
        }
        $t = array_map('intval', explode(':', $time . ':0:0'));
        return mktime($t[0], $t[1], $t[2], $m, $d, $y);
    }

    public static function sum(array $rows): float
    {
        return array_sum(array_column($rows, 'price'));
    }

    /**
     * Filter by period: day (Y-m-d), month (Y-m), year (Y), all. Optional profile.
     */
    public static function filter(array $rows, string $period, string $value, string $profile = ''): array
    {
        $fmt = ['day' => 'Y-m-d', 'month' => 'Y-m', 'year' => 'Y'][$period] ?? null;
        return array_values(array_filter($rows, function ($r) use ($fmt, $value, $profile) {
            if ($profile !== '' && $r['profile'] !== $profile) {
                return false;
            }
            return $fmt === null || date($fmt, $r['ts']) === $value;
        }));
    }

    public static function daily(array $rows): array
    {
        $o = [];
        foreach ($rows as $r) {
            $k = date('Y-m-d', $r['ts']);
            $o[$k] = ($o[$k] ?? 0) + $r['price'];
        }
        ksort($o);
        return $o;
    }

    public static function byProfile(array $rows): array
    {
        $o = [];
        foreach ($rows as $r) {
            $o[$r['profile']] = ($o[$r['profile']] ?? 0) + $r['price'];
        }
        arsort($o);
        return $o;
    }

    /** Record format used by Mikhmon, for POS or tests */
    public static function recordName(array $x): string
    {
        return implode('-|-', [
            strtolower(date('M/d/Y', $x['ts'])), date('H:i:s', $x['ts']), $x['user'], (string)(int)$x['price'],
            $x['ip'] ?? '', $x['mac'] ?? '', $x['validity'] ?? '', $x['profile'], $x['comment'] ?? '',
        ]);
    }
}
