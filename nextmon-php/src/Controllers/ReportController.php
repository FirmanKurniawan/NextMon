<?php
class ReportController
{
    private static function filters(): array
    {
        $period = in_array(App::get('period'), ['day', 'month', 'year', 'all'], true) ? App::get('period') : 'month';
        $def = ['day' => date('Y-m-d'), 'month' => date('Y-m'), 'year' => date('Y'), 'all' => ''];
        $val = App::get('value', $def[$period]);
        $ok = ['day' => '/^\d{4}-\d{2}-\d{2}$/', 'month' => '/^\d{4}-\d{2}$/', 'year' => '/^\d{4}$/', 'all' => '/^$/'][$period];
        if (!preg_match($ok, $val)) {
            $val = $def[$period];
        }
        return [$period, $val, App::get('profile')];
    }

    public static function index(): void
    {
        $r = App::driver();
        [$period, $val, $prof] = self::filters();
        $all = Sales::fetch($r, App::currentRouterId());
        $rows = Sales::filter($all, $period, $val, $prof);
        $profiles = array_values(array_unique(array_column($all, 'profile')));
        sort($profiles);
        $total = Sales::sum($rows);
        $daily = Sales::daily($rows);
        $byProfile = Sales::byProfile($rows);
        $count = count($rows);
        [$page, $pg, $pages] = App::paginate($rows, 100);
        App::render('reports', [
            'title' => t('Sales report'), 'page' => 'reports', 'period' => $period, 'value' => $val, 'prof' => $prof, 'profiles' => $profiles,
            'rows' => $page, 'pg' => $pg, 'pages' => $pages, 'total' => $total, 'count' => $count, 'avg' => $count ? $total / $count : 0,
            'chart' => ['labels' => array_keys($daily), 'values' => array_values($daily), 'plabels' => array_keys($byProfile), 'pvalues' => array_values($byProfile)],
        ]);
    }

    private static function cell(string $v): string
    {
        return (strlen($v) && strpos("=+-@\t\r", $v[0]) !== false) ? "'" . $v : $v;
    }

    public static function export(): void
    {
        $r = App::driver();
        [$period, $val, $prof] = self::filters();
        $rows = Sales::filter(Sales::fetch($r, App::currentRouterId()), $period, $val, $prof);
        $fmt = App::get('format') === 'xls' ? 'xls' : 'csv';
        $fname = 'nextmon-sales-' . ($val ?: 'all') . '.' . $fmt;
        $head = ['Date', 'Time', 'User', 'Price', 'IP', 'MAC', 'Validity', 'Profile', 'Comment'];
        Audit::log('report.export', $fname);
        if ($fmt === 'csv') {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $fname . '"');
            echo "\xEF\xBB\xBF";
            $out = fopen('php://output', 'w');
            fputcsv($out, $head, ",", chr(34), "");
            foreach ($rows as $x) {
                fputcsv($out, array_map([self::class, 'cell'], [$x['date'], $x['time'], $x['user'], (string)(int)$x['price'], $x['ip'], $x['mac'], $x['validity'], $x['profile'], $x['comment']]), ",", chr(34), "");
            }
            fclose($out);
            exit;
        }
        // XLS: HTML table that Excel/LibreOffice open natively
        header('Content-Type: application/vnd.ms-excel; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $fname . '"');
        echo "\xEF\xBB\xBF<html><head><meta charset=\"utf-8\"></head><body><table border=\"1\"><tr>";
        foreach ($head as $h) {
            echo '<th>' . e($h) . '</th>';
        }
        echo '</tr>';
        foreach ($rows as $x) {
            echo '<tr>';
            foreach ([$x['date'], $x['time'], $x['user'], (int)$x['price'], $x['ip'], $x['mac'], $x['validity'], $x['profile'], $x['comment']] as $c) {
                echo '<td>' . e(self::cell((string)$c)) . '</td>';
            }
            echo '</tr>';
        }
        echo '</table></body></html>';
        exit;
    }

    public static function delete(): void
    {
        $owner = strtolower(preg_replace('/[^A-Za-z0-9]/', '', App::post('owner')));
        if ($owner === '') {
            App::redirect('/reports', t('Invalid month.'), 'err');
        }
        $r = App::driver();
        $n = 0;
        foreach ($r->print('/system/script', ['comment' => 'mikhmon', 'owner' => $owner], ['name']) as $s) {
            $r->remove('/system/script', $s['.id']);
            $n++;
        }
        Sales::flush(App::currentRouterId());
        Audit::log('report.delete', "$owner ($n)");
        App::redirect('/reports', t('Deleted :n sales records.', [':n' => $n]));
    }
}
