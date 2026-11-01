<?php
class ToolsController
{
    public static function index(): void
    {
        $r = App::driver();
        $ifaces = array_column($r->print('/interface', [], ['name']), 'name');
        App::render('tools', ['title' => t('Tools'), 'page' => 'tools', 'ifaces' => $ifaces]);
    }

    /** Keep the last row for each key (streaming commands repeat rows while they update). */
    private static function lastBy(array $rows, callable $key): array
    {
        $o = [];
        foreach ($rows as $r) {
            $o[$key($r)] = $r;
        }
        return array_values($o);
    }

    public static function run(): void
    {
        $r = App::driver();
        $tool = App::post('tool');
        // read-only roles may look (health, logs) but not make the router send packets / sniff traffic
        if (in_array($tool, ['ping', 'traceroute', 'torch'], true) && !Auth::can('write')) {
            App::json(['ok' => false, 'error' => t('Your role cannot access this page.')], 403);
        }
        App::setTimeout($r, 25);
        switch ($tool) {
            case 'ping':
            case 'traceroute':
                $addr = App::post('address');
                if (!preg_match('/^[A-Za-z0-9.\-:]{1,100}$/', $addr)) {
                    App::json(['ok' => false, 'error' => t('Invalid address.')]);
                }
                if ($tool === 'ping') {
                    $rows = $r->command('/tool/ping', ['address' => $addr, 'count' => (string)max(1, min(10, (int)App::post('count', '4')))]);
                } else {
                    $rows = self::lastBy($r->command('/tool/traceroute', ['address' => $addr, 'count' => '2']), fn($x) => ($x['.section'] ?? '') . ($x['address'] ?? uniqid()));
                }
                Audit::log('tools.' . $tool, $addr);
                App::json(['ok' => true, 'rows' => $rows]);
            case 'torch':
                $if = preg_replace('/[^A-Za-z0-9_.\-]/', '', App::post('interface'));
                $dur = (string)max(1, min(10, (int)App::post('duration', '3')));
                $rows = $r->command('/tool/torch', ['interface' => $if, 'duration' => $dur, 'src-address' => '0.0.0.0/0', 'dst-address' => '0.0.0.0/0', 'ip-protocol' => 'any']);
                $rows = self::lastBy($rows, fn($x) => ($x['src-address'] ?? '') . '>' . ($x['dst-address'] ?? '') . ($x['ip-protocol'] ?? '') . ($x['dst-port'] ?? ''));
                usort($rows, fn($a, $b) => (int)($b['rx'] ?? 0) <=> (int)($a['rx'] ?? 0));
                App::json(['ok' => true, 'rows' => array_slice($rows, 0, 40)]);
            case 'health':
                $g = Pipe::prints($r, ['res' => ['/system/resource'], 'health' => ['/system/health'], 'idn' => ['/system/identity']]);
                App::json(['ok' => true, 'resource' => $g['res'][0] ?? [], 'health' => $g['health'][0] ?? [], 'identity' => $g['idn'][0]['name'] ?? '']);
            case 'logs':
                $topic = strtolower(App::post('topic'));
                $rows = $r->print('/log', [], ['time', 'topics', 'message']);
                if ($topic !== '') {
                    $rows = array_values(array_filter($rows, fn($x) => strpos(strtolower($x['topics'] ?? ''), $topic) !== false));
                }
                App::json(['ok' => true, 'rows' => array_reverse(array_slice($rows, -150))]);
        }
        App::json(['ok' => false, 'error' => 'unknown tool'], 400);
    }
}
