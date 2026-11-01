<?php
// tenant-ok-file: compiled language dictionary in data/cache (identical for every tenant, no tenant data)
/**
 * Tiny i18n. Source strings are English; lang/id.php maps English => Indonesian.
 * Placeholders use :name style, e.g. t('Deleted :n users', [':n' => 3]).
 */
final class I18n
{
    private static array $dict = [];
    private static string $lang = 'en';

    public static function init(string $lang): void
    {
        $lang = in_array($lang, ['id', 'en'], true) ? $lang : 'id';
        self::$lang = $lang;
        $f = dirname(__DIR__) . '/lang/' . $lang . '.php';
        $files = array_merge([$f], glob(dirname(__DIR__) . '/lang/' . $lang . '.d/*.php') ?: []);
        // merged dictionary cached as one serialized file, rebuilt when any lang file changes (saves compiling ~90 KB of
        // PHP arrays on every request when opcache is off)
        $sig = '';
        foreach ($files as $x) {
            $sig .= $x . '@' . (int)@filemtime($x) . ';';
        }
        $sig = md5($sig);
        $cache = class_exists('Store', false) || class_exists('Store') ? Store::dir() . '/cache/lang-' . $lang . '.ser' : '';
        if ($cache !== '' && is_file($cache)) {   // tenant-ok: compiled language dictionary, no tenant data
            // tenant-ok: compiled language dictionary
            $c = @unserialize((string)@file_get_contents($cache), ['allowed_classes' => false]);   // tenant-ok: compiled language dictionary, no tenant data
            if (is_array($c) && ($c['sig'] ?? '') === $sig && is_array($c['dict'] ?? null)) {
                self::$dict = $c['dict'];
                return;
            }
        }
        self::$dict = is_file($f) ? (array)(require $f) : [];
        foreach (array_slice($files, 1) as $lf) {
            self::$dict = array_merge(self::$dict, (array)require $lf);
        }
        if ($cache !== '') {
            $tmp = $cache . '.' . bin2hex(random_bytes(3)) . '.tmp';
            if (@file_put_contents($tmp, serialize(['sig' => $sig, 'dict' => self::$dict])) !== false) {   // tenant-ok: compiled language dictionary, no tenant data
                @rename($tmp, $cache) || @unlink($tmp);   // tenant-ok: compiled language dictionary, no tenant data
            }
        }
    }

    public static function lang(): string
    {
        return self::$lang;
    }

    public static function t(string $s, array $r = []): string
    {
        $o = self::$dict[$s] ?? $s;
        return $r ? strtr($o, $r) : $o;
    }
}
