<?php
/**
 * Batch helpers: one round-trip for N independent commands when the driver can pipeline (RouterOS / CachedDriver),
 * a plain loop otherwise (Demo). Same results and same first-error behaviour either way.
 */
final class Pipe
{
    /** Kill switch / A-B switch: NEXTMON_PIPELINE=0 makes every helper fall back to one round-trip per command. */
    private static function on(): bool
    {
        return getenv('NEXTMON_PIPELINE') !== '0';
    }

    /**
     * @param array<string|int,array> $reqs key => [path, query?, props?]
     * @return array<string|int,array> key => rows
     */
    public static function prints(Driver $r, array $reqs): array
    {
        if (self::on() && count($reqs) > 1 && method_exists($r, 'printMany')) {
            return $r->printMany($reqs);
        }
        $out = [];
        foreach ($reqs as $k => $q) {
            $out[$k] = $r->print((string)$q[0], (array)($q[1] ?? []), (array)($q[2] ?? []));
        }
        return $out;
    }

    /** @param array[] $rows attribute maps; @return string[] new ids */
    public static function adds(Driver $r, string $path, array $rows): array
    {
        if (self::on() && count($rows) > 1 && method_exists($r, 'addMany')) {
            return $r->addMany($path, $rows);
        }
        $ids = [];
        foreach ($rows as $a) {
            $ids[] = $r->add($path, $a);
        }
        return $ids;
    }

    /**
     * Add rows, never throwing per row: @return array[] ['id' => string, 'err' => ?string] in order (bulk import).
     */
    public static function tryAdds(Driver $r, string $path, array $rows): array
    {
        if (self::on() && count($rows) > 1 && method_exists($r, 'addTry')) {
            return $r->addTry($path, $rows);
        }
        $out = [];
        foreach ($rows as $a) {
            try {
                $out[] = ['id' => $r->add($path, $a), 'err' => null];
            } catch (RouterOSException $e) {
                $out[] = ['id' => '', 'err' => $e->getMessage()];
            }
        }
        return $out;
    }

    /** @param array[] $changes list of [id, attrs]; @return array[] ['err' => ?string] in order */
    public static function trySets(Driver $r, string $path, array $changes): array
    {
        if (self::on() && count($changes) > 1 && method_exists($r, 'setTry')) {
            return $r->setTry($path, $changes);
        }
        $out = [];
        foreach ($changes as $c) {
            try {
                $r->set($path, (string)$c[0], (array)$c[1]);
                $out[] = ['err' => null];
            } catch (RouterOSException $e) {
                $out[] = ['err' => $e->getMessage()];
            }
        }
        return $out;
    }

    /** Same command for many attribute sets. */
    public static function commands(Driver $r, string $path, array $attrList): void
    {
        if (self::on() && count($attrList) > 1 && method_exists($r, 'commandMany')) {
            $r->commandMany($path, $attrList);
            return;
        }
        foreach ($attrList as $a) {
            $r->command($path, $a);
        }
    }

    /** @param string[] $ids */
    public static function removes(Driver $r, string $path, array $ids): void
    {
        if (self::on() && count($ids) > 1 && method_exists($r, 'removeMany')) {
            $r->removeMany($path, $ids);
            return;
        }
        foreach ($ids as $id) {
            $r->remove($path, $id);
        }
    }

    /** @param array<string,array> $changes id => attrs */
    public static function sets(Driver $r, string $path, array $changes): void
    {
        if (self::on() && count($changes) > 1 && method_exists($r, 'setMany')) {
            $r->setMany($path, $changes);
            return;
        }
        foreach ($changes as $id => $a) {
            $r->set($path, (string)$id, $a);
        }
    }
}
