<?php
/**
 * AES-256-GCM encryption for secrets at rest (router passwords, Telegram token).
 * The key is generated on first use and stored in data/secret.key (keep it out of web root, back it up).
 */
final class Crypto
{
    private static ?string $key = null;

    /** Drop the cached key (data dir changed, e.g. in tests). */
    public static function reset(): void
    {
        self::$key = null;
    }

    private static function key(): string
    {
        if (self::$key === null) {
            $f = Store::path('secret.key');
            if (!is_file($f)) {
                // exclusive create: two first requests racing must never end up with two different keys
                $old = umask(0077);
                $h = @fopen($f, 'x');
                umask($old);
                if ($h) {
                    fwrite($h, base64_encode(random_bytes(32)));
                    fflush($h);
                    fclose($h);
                }
            }
            $raw = '';
            for ($i = 0; $i < 20; $i++) {   // the winner of the race may still be writing
                $raw = trim((string)@file_get_contents($f));
                if ($raw !== '') {
                    break;
                }
                usleep(50000);
            }
            if (DIRECTORY_SEPARATOR === '/' && (@fileperms($f) & 0077)) {
                @chmod($f, 0600);   // key must never be group/world readable
            }
            self::$key = (string)base64_decode($raw, true);
            if (strlen(self::$key) !== 32) {
                throw new RuntimeException('data/secret.key is corrupt');
            }
        }
        return self::$key;
    }

    public static function encrypt(string $plain): string
    {
        if ($plain === '') {
            return '';
        }
        if (!function_exists('openssl_encrypt')) {
            throw new RuntimeException('PHP openssl extension is required');
        }
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($ct === false) {
            throw new RuntimeException('Encryption failed');
        }
        return 'v1:' . base64_encode($iv . $tag . $ct);
    }

    /**
     * Key rotation: generate a new data key, keep the old one as data/secret.key.bak-<time> (0600) and re-encrypt every
     * secret NextMON stores (router passwords, Telegram token, payment gateway keys, mock-gateway secret).
     * Everything is decrypted with the OLD key first, so a failure before the swap changes nothing.
     * Delete the .bak file once you are sure (and from any backups). Returns the number of values re-encrypted.
     */
    public static function rotate(): int
    {
        // every workspace's secrets (one platform key protects them all)
        $ids = array_column(Workspace::all(), 'id');
        if (!in_array('main', $ids, true)) {
            $ids[] = 'main';
        }
        $plan = [];
        foreach ($ids as $ws) {
            $plan[$ws] = Workspace::run($ws, function () {
                $routers = [];
                foreach ((array)Store::read('routers', []) as $r) {
                    if (!empty($r['pass'])) {
                        $routers[$r['id']] = self::decrypt((string)$r['pass']);
                    }
                }
                $settings = (array)Store::read('settings', []);
                $tg = !empty($settings['telegram']['token']) ? self::decrypt((string)$settings['telegram']['token']) : '';
                $shop = (array)Store::read('shop', []);
                $gw = [];
                foreach (Payments::all() as $gid => $g) {
                    foreach ($g->fields() as $fld) {
                        if (!empty($fld['secret']) && !empty($shop['gw'][$gid][$fld['key']])) {
                            $gw[$gid][$fld['key']] = self::decrypt((string)$shop['gw'][$gid][$fld['key']]);
                        }
                    }
                }
                $mock = !empty($shop['mock_secret']) ? self::decrypt((string)$shop['mock_secret']) : '';
                return [$routers, $tg, $gw, $mock];
            });
        }

        $f = Store::path('secret.key');
        self::key(); // make sure the old key exists before we back it up
        $bak = $f . '.bak-' . date('YmdHis');
        $old = umask(0077);
        copy($f, $bak);
        $tmp = $f . '.new';
        file_put_contents($tmp, base64_encode(random_bytes(32)));
        umask($old);
        @chmod($bak, 0600);
        @chmod($tmp, 0600);
        if (!@rename($tmp, $f)) {
            copy($tmp, $f);
            @unlink($tmp);
        }
        self::reset();

        $n = 0;
        foreach ($plan as $ws => [$routers, $tg, $gw, $mock]) {
            Workspace::run((string)$ws, function () use ($routers, $tg, $gw, $mock, &$n) {
                if ($routers) {
                    Store::update('routers', function ($l) use ($routers, &$n) {
                        foreach ($l as $i => $r) {
                            if (isset($routers[$r['id']]) && $routers[$r['id']] !== '') {
                                $l[$i]['pass'] = self::encrypt($routers[$r['id']]);
                                $n++;
                            }
                        }
                        return $l;
                    }, []);
                }
                if ($tg !== '') {
                    Store::update('settings', function ($s) use ($tg, &$n) {
                        $s['telegram']['token'] = self::encrypt($tg);
                        $n++;
                        return $s;
                    }, []);
                }
                if ($gw || $mock !== '') {
                    Store::update('shop', function ($s) use ($gw, $mock, &$n) {
                        foreach ($gw as $gid => $fields) {
                            foreach ($fields as $k => $v) {
                                if ($v !== '') {
                                    $s['gw'][$gid][$k] = self::encrypt($v);
                                    $n++;
                                }
                            }
                        }
                        if ($mock !== '') {
                            $s['mock_secret'] = self::encrypt($mock);
                            $n++;
                        }
                        return $s;
                    }, []);
                }
            });
        }
        return $n;
    }
    public static function decrypt(string $blob): string
    {
        if ($blob === '' || strncmp($blob, 'v1:', 3) !== 0) {
            return '';
        }
        $raw = base64_decode(substr($blob, 3), true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ct = substr($raw, 28);
        $pt = openssl_decrypt($ct, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        return $pt === false ? '' : $pt;
    }
}
