<?php
class VoucherController
{
    public static function index(): void
    {
        $r = App::driver();
        $got = Pipe::prints($r, [
            'profiles' => ['/ip/hotspot/user/profile', [], ['name', 'on-login']],
            'users' => ['/ip/hotspot/user', [], ['name', 'profile', 'comment', 'uptime']],
            'servers' => ['/ip/hotspot', [], ['name']],
        ]);
        $profiles = $got['profiles'];
        $meta = [];
        foreach ($profiles as $p) {
            $meta[$p['name']] = Scripts::parseMeta((string)($p['on-login'] ?? ''));
        }
        $batches = [];
        foreach ($got['users'] as $u) {
            $b = Voucher::batchOf((string)($u['comment'] ?? ''));
            if ($b === '') {
                continue;
            }
            $batches[$b] ??= ['tag' => $b, 'count' => 0, 'used' => 0, 'profile' => $u['profile'] ?? ''];
            $batches[$b]['count']++;
            if (($u['uptime'] ?? '0s') !== '0s') {
                $batches[$b]['used']++;
            }
        }
        if (Reseller::isReseller(Auth::user())) {
            $batches = array_filter($batches, fn($b) => Reseller::mayPrint($b['tag']));
        }
        $servers = array_column($got['servers'], 'name');
        $cfg = App::routerCfg();
        App::render('vouchers', [
            'title' => t('Vouchers'), 'page' => 'vouchers', 'profiles' => array_column($profiles, 'name'), 'meta' => $meta,
            'batches' => array_reverse(array_values($batches)), 'servers' => $servers, 'templates' => self::customTemplates(),
            'maxQty' => (int)Store::setting('max_qty', 500),
            'hotspot' => (string)(($cfg['hotspot_name'] ?? '') ?: Store::setting('hotspot_name')),
            'loginBase' => (string)Store::setting('login_url', 'http://hotspot.local/login'),
        ]);
    }

    public static function generate(): void
    {
        $r = App::driver();
        $profile = App::post('profile');
        if ($profile === '') {
            App::redirect('/vouchers', t('Choose a profile.'), 'err');
        }
        $limit = strtolower(App::post('limit_uptime'));
        if ($err = HotspotController::checkTimeLimit($r, $profile, $limit)) {
            App::redirect('/vouchers', $err, 'err');
        }
        $res = Voucher::generate($r, [
            'profile' => $profile, 'qty' => (int)App::post('qty', '10'), 'prefix' => App::post('prefix'), 'length' => (int)App::post('length', '6'),
            'charset' => App::post('charset', 'lowernum'), 'mode' => App::post('mode', 'vc'), 'batch' => App::post('batch'),
            'limit_uptime' => $limit, 'limit_bytes' => App::post('limit_bytes'), 'server' => App::post('server', 'all'),
        ]);
        $n = count($res['items']);
        Reseller::recordBatch($res['comment']);
        Audit::log('vouchers.generate', $n . ' x ' . $profile . ' [' . $res['comment'] . ']');
        Notify::event('voucher', "Voucher batch generated: $n x $profile ({$res['comment']})");
        $to = '/vouchers/print?comment=' . rawurlencode($res['comment']);
        if (App::post('tpl') !== '') {
            $to .= '&tpl=' . rawurlencode(App::post('tpl'));
        } elseif (preg_match('/^[a-z0-9_-]{1,24}$/i', App::post('design'))) {
            $to .= '&design=' . rawurlencode(App::post('design'));
        }
        App::redirect($to, t(':n vouchers created.', [':n' => $n]));
    }

    /** Single-voucher quick print: /vouchers/quick (POST code) -> print view for that one user. */
    public static function quick(): void
    {
        $code = App::post('code');
        if ($code === '') {
            App::redirect('/vouchers', t('Enter a voucher code.'), 'err');
        }
        App::redirect('/vouchers/print?user=' . rawurlencode($code));
    }

    public static function deleteBatch(): void
    {
        $r = App::driver();
        $tag = App::post('tag');
        $del = [];
        foreach ($r->print('/ip/hotspot/user', [], ['name', 'comment']) as $u) {
            if ($tag !== '' && Voucher::batchOf((string)($u['comment'] ?? '')) === $tag) {
                $del[] = $u['.id'];
            }
        }
        Pipe::removes($r, '/ip/hotspot/user', $del);   // pipelined: 100 removals per round-trip
        $n = count($del);
        Audit::log('vouchers.delete', "$tag ($n)");
        App::redirect('/vouchers', t('Deleted :n users.', [':n' => $n]));
    }

    public static function printView(): void
    {
        $r = App::driver();
        $tag = App::get('comment');
        $one = App::get('user');
        $profiles = [];
        $got = Pipe::prints($r, [
            'profiles' => ['/ip/hotspot/user/profile', [], ['name', 'on-login']],
            // single-voucher print: let the router filter by name instead of shipping the whole user list
            'users' => ['/ip/hotspot/user', $one !== '' ? ['name' => $one] : [], ['name', 'password', 'profile', 'comment', 'limit-uptime', 'limit-bytes-total']],
        ]);
        foreach ($got['profiles'] as $p) {
            $profiles[$p['name']] = Scripts::parseMeta((string)($p['on-login'] ?? ''));
        }
        $items = [];
        foreach ($got['users'] as $u) {
            $batch = Voucher::batchOf((string)($u['comment'] ?? ''));
            if ($one !== '' ? $u['name'] !== $one : ($tag === '' || $batch !== $tag)) {
                continue;
            }
            if (!Reseller::mayPrint($batch)) { // IDOR guard: resellers must not read other people's voucher passwords
                continue;
            }
            $m = $profiles[$u['profile']] ?? null;
            $items[] = [
                'user' => $u['name'], 'pass' => $u['password'] ?? '', 'profile' => $u['profile'],
                'price' => $m && $m['sprice'] !== '' ? money($m['sprice']) : '', 'validity' => $m['validity'] ?? '',
                'limit' => $u['limit-uptime'] ?? '', 'comment' => $batch, 'url' => Voucher::loginUrl($u['name'], $u['password'] ?? ''),
            ];
        }
        $cfg = App::routerCfg();
        App::renderBare('voucher_print', [
            'items' => $items, 'tag' => $one !== '' ? $one : $tag, 'hotspot' => (string)(($cfg['hotspot_name'] ?? '') ?: Store::setting('hotspot_name')),
            'templates' => self::customTemplates(), 'presets' => self::presets(), 'defaultPreset' => (string)Store::setting('voucher_default_preset', ''),
            'loginBase' => (string)Store::setting('login_url', 'http://hotspot.local/login'),
        ]);
    }

    /** Safe placeholder substitution for custom templates (server-side fallback; the print view fills client-side). */
    public static function applyTemplate(string $html, array $v, string $hotspot): string
    {
        $map = [
            '{{user}}' => e($v['user']), '{{pass}}' => e($v['pass']), '{{price}}' => e($v['price']), '{{validity}}' => e($v['validity']),
            '{{profile}}' => e($v['profile']), '{{limit}}' => e($v['limit']), '{{comment}}' => e($v['comment']), '{{hotspot}}' => e($hotspot),
            '{{login_url}}' => e($v['url']), '{{qr}}' => '<span class="qr" data-qr="' . e($v['url']) . '"></span>',
        ];
        return strtr($html, $map);
    }

    // ---- custom templates + presets --------------------------------------------------------------

    /** Custom HTML templates with their card size in mm. */
    public static function customTemplates(): array
    {
        $out = [];
        foreach ((array)Store::setting('templates', []) as $t) {
            if (!isset($t['id'], $t['name'], $t['html'])) {
                continue;
            }
            $out[] = ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'html' => self::cleanHtml((string)$t['html']), 'w' => (float)($t['w'] ?? 70), 'h' => (float)($t['h'] ?? 40)];
        }
        return $out;
    }

    /** Sanitised template HTML, memoised by content hash + sanitiser version (the DOM rebuild is the costly part of every view). */
    private static function cleanHtml(string $html): string
    {
        $key = 'tplsan:' . substr(sha1($html . '|' . (int)@filemtime(__DIR__ . '/../Sanitize.php')), 0, 24);
        $hit = Cache::get($key);
        if (is_string($hit)) {
            return $hit;
        }
        $clean = Sanitize::templateHtml($html);
        Cache::set($key, $clean, 86400);
        return $clean;
    }

    public static function presets(): array
    {
        return array_values(array_filter((array)Store::setting('voucher_presets', []), fn($p) => isset($p['id'], $p['name'], $p['opts'])));
    }

    /** Whitelist and clamp print settings coming from the browser. */
    public static function cleanOpts($raw): array
    {
        $o = is_array($raw) ? $raw : [];
        $bool = fn($k, $d = false) => isset($o[$k]) ? (bool)$o[$k] : $d;
        $num = fn($k, $lo, $hi, $d) => isset($o[$k]) && is_numeric($o[$k]) ? max($lo, min($hi, (float)$o[$k])) : $d;
        $in = fn($k, $list, $d) => isset($o[$k]) && in_array($o[$k], $list, true) ? $o[$k] : $d;
        $f = [];
        foreach (['brand', 'logo', 'profile', 'validity', 'price', 'pass', 'qr', 'dns', 'serial', 'wifi'] as $k) {
            $f[$k] = isset($o['f'][$k]) ? (bool)$o['f'][$k] : true;
        }
        $logo = (string)($o['logo'] ?? '');
        if (!preg_match('#^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$#', $logo) || strlen($logo) > 150000) {
            $logo = '';
        }
        $design = (string)($o['design'] ?? 'aurora');
        if (!preg_match('/^(c:)?[a-z0-9_-]{1,24}$/i', $design)) {
            $design = 'aurora';
        }
        return [
            'design' => $design, 'paper' => $in('paper', ['a4', 'a5', 'letter', 'f4', 't58', 't80'], 'a4'), 'land' => $bool('land'),
            'cols' => (int)$num('cols', 0, 8, 0), 'gap' => $num('gap', 0, 20, 3), 'margin' => $num('margin', 0, 30, 6), 'scale' => $num('scale', 30, 200, 100),
            'f' => $f, 'qrMode' => $in('qrMode', ['login', 'user', 'code'], 'login'), 'ecc' => $in('ecc', ['L', 'M', 'Q', 'H'], 'M'),
            'qrStyle' => $in('qrStyle', ['square', 'round'], 'square'), 'qrLogo' => $bool('qrLogo'), 'ink' => $bool('ink'), 'guides' => $bool('guides', true),
            'accent' => preg_match('/^#[0-9a-fA-F]{6}$/', (string)($o['accent'] ?? '')) ? (string)$o['accent'] : '#0b7285',
            'name' => mb_substr(trim((string)($o['name'] ?? '')), 0, 60), 'logo' => $logo,
            'group' => $bool('group', false), 'ssid' => mb_substr(trim((string)($o['ssid'] ?? '')), 0, 32), 'wifipass' => mb_substr(trim((string)($o['wifipass'] ?? '')), 0, 63),
            'tqr' => $in('tqr', ['native', 'raster', 'off'], 'native'),
        ];
    }

    public static function presetSave(): void
    {
        $name = mb_substr(App::post('name'), 0, 40);
        $opts = json_decode(App::post('opts', '{}'), true);
        if ($name === '' || !is_array($opts)) {
            App::json(['ok' => false, 'error' => t('Name and HTML are required.')], 422);
        }
        $id = bin2hex(random_bytes(4));
        $clean = self::cleanOpts($opts);
        Store::update('settings', function ($s) use ($id, $name, $clean) {
            $list = array_values(array_filter((array)($s['voucher_presets'] ?? []), fn($p) => ($p['name'] ?? '') !== $name));
            $list[] = ['id' => $id, 'name' => $name, 'opts' => $clean];
            $s['voucher_presets'] = array_slice($list, -30);
            return $s;
        }, []);
        Audit::log('voucher.preset', $name);
        App::json(['ok' => true, 'id' => $id, 'presets' => self::presets()]);
    }

    public static function presetDelete(): void
    {
        $id = App::post('id');
        Store::update('settings', function ($s) use ($id) {
            $s['voucher_presets'] = array_values(array_filter((array)($s['voucher_presets'] ?? []), fn($p) => ($p['id'] ?? '') !== $id));
            if (($s['voucher_default_preset'] ?? '') === $id) {
                $s['voucher_default_preset'] = '';
            }
            return $s;
        }, []);
        App::json(['ok' => true, 'presets' => self::presets()]);
    }

    public static function presetDefault(): void
    {
        $id = App::post('id');
        $ok = (bool)array_filter(self::presets(), fn($p) => $p['id'] === $id);
        if ($ok) {
            Store::update('settings', function ($s) use ($id) {
                $s['voucher_default_preset'] = $id;
                return $s;
            }, []);
        }
        App::json(['ok' => $ok]);
    }

    // ---- template editor -----------------------------------------------------------------------

    public static function templates(): void
    {
        App::render('templates', ['title' => t('Voucher templates'), 'page' => 'vouchers', 'templates' => self::customTemplates()]);
    }

    public static function templateSave(): void
    {
        $name = mb_substr(App::post('name'), 0, 40);
        $html = (string)($_POST['html'] ?? '');
        if ($name === '' || $html === '') {
            App::redirect('/vouchers/templates', t('Name and HTML are required.'), 'err');
        }
        // templates are plain markup + CSS: rebuild through an allow-list sanitiser (a regex blacklist is bypassable)
        $html = Sanitize::templateHtml(mb_substr($html, 0, 60000));
        $id = App::post('id');
        $w = max(20.0, min(300.0, (float)App::post('w', '70')));
        $h = max(10.0, min(300.0, (float)App::post('h', '40')));
        Store::update('settings', function ($s) use ($id, $name, $html, $w, $h) {
            $list = $s['templates'] ?? [];
            $found = false;
            foreach ($list as $i => $t) {
                if ($id !== '' && $t['id'] === $id) {
                    $list[$i] = ['id' => $id, 'name' => $name, 'html' => $html, 'w' => $w, 'h' => $h];
                    $found = true;
                }
            }
            if (!$found) {
                $list[] = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'html' => $html, 'w' => $w, 'h' => $h];
            }
            $s['templates'] = $list;
            return $s;
        }, []);
        Audit::log('template.save', $name);
        App::redirect('/vouchers/templates', t('Template saved.'));
    }

    public static function templateDelete(): void
    {
        $id = App::post('id');
        Store::update('settings', function ($s) use ($id) {
            $s['templates'] = array_values(array_filter($s['templates'] ?? [], fn($t) => $t['id'] !== $id));
            return $s;
        }, []);
        App::redirect('/vouchers/templates', t('Template deleted.'));
    }
}
