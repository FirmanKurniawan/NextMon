<?php
/** Admin: online shop orders (/orders). */
class OrdersController
{
    private static function filtered(): array
    {
        Orders::expireStale();
        $st = App::get('status');
        $gw = App::get('gateway');
        $q = mb_strtolower(App::get('q'));
        $from = App::get('from') !== '' ? strtotime(App::get('from') . ' 00:00:00') : 0;
        $to = App::get('to') !== '' ? strtotime(App::get('to') . ' 23:59:59') : PHP_INT_MAX;
        return array_values(array_filter(Orders::all(), function ($o) use ($st, $gw, $q, $from, $to) {
            if ($st !== '' && $o['status'] !== $st) {
                return false;
            }
            if ($gw !== '' && $o['gateway'] !== $gw) {
                return false;
            }
            if ($o['created'] < $from || $o['created'] > $to) {
                return false;
            }
            if ($q !== '') {
                $hay = mb_strtolower($o['id'] . ' ' . ($o['customer']['name'] ?? '') . ' ' . ($o['customer']['phone'] ?? '') . ' ' . ($o['customer']['email'] ?? '') . ' ' . ($o['voucher']['user'] ?? '') . ' ' . $o['ref']);
                if (strpos($hay, $q) === false) {
                    return false;
                }
            }
            return true;
        }));
    }

    public static function index(): void
    {
        $rows = self::filtered();
        $sum = ['count' => count($rows), 'paid' => 0, 'revenue' => 0, 'pending' => 0, 'attention' => 0];
        foreach ($rows as $o) {
            if ($o['status'] === 'paid') {
                $sum['paid']++;
                $sum['revenue'] += (int)$o['amount'];
                if (empty($o['voucher'])) {
                    $sum['attention']++;
                }
            } elseif ($o['status'] === 'pending') {
                $sum['pending']++;
            }
            if (!empty($o['flag'])) {
                $sum['attention']++;
            }
        }
        [$page, $pg, $pages] = App::paginate($rows, 50);
        App::render('orders', ['title' => t('Online orders'), 'page' => 'orders', 'rows' => $page, 'pg' => $pg, 'pages' => $pages, 'total' => count($rows), 'sum' => $sum, 'gateways' => Payments::all()]);
    }

    public static function view(): void
    {
        $o = Orders::get(App::get('id'));
        if (!$o) {
            App::redirect('/orders', t('Order not found.'), 'err');
        }
        App::render('orders_view', ['title' => $o['id'], 'page' => 'orders', 'o' => $o, 'gateway' => Payments::get($o['gateway'])]);
    }

    public static function action(): void
    {
        $id = App::post('id');
        $o = Orders::get($id);
        if (!$o) {
            App::redirect('/orders', t('Order not found.'), 'err');
        }
        $by = Auth::user()['username'] ?? '-';
        $do = App::post('do');
        $to = '/orders/view?id=' . rawurlencode($id);
        switch ($do) {
            case 'markpaid':
                if ($o['status'] === 'refunded') {
                    App::redirect($to, t('A refunded order cannot be marked paid.'), 'err');
                }
                [$ok, $msg] = Orders::markPaid($id, 'admin:' . $by, null);
                Orders::update($id, function ($x) use ($by) {
                    Orders::note($x, $by, 'Marked paid manually');
                    return $x;
                });
                Audit::log('shop.markpaid', $id);
                App::redirect($to, $ok ? t('Order marked as paid.') : t('Could not mark as paid: :m', [':m' => $msg]), $ok ? 'ok' : 'err');
                // no break needed: redirect exits
            case 'retry':
                Orders::markPaid($id, 'admin:' . $by, null);
                $n = Orders::retryFulfil($id);
                Audit::log('shop.retry', $id);
                App::redirect($to, !empty($n['voucher']) ? t('Voucher created.') : t('Router still unreachable: :m', [':m' => (string)($n['fulfil_err'] ?? '')]), !empty($n['voucher']) ? 'ok' : 'err');
            case 'refund':
                if (!Auth::can('admin')) {
                    App::redirect($to, t('Your role cannot access this page.'), 'err');
                }
                $note = App::post('note');
                if (mb_strlen($note) < 3) {
                    App::redirect($to, t('Write a refund note (how/when the money was returned).'), 'err');
                }
                [$ok, $msg] = Orders::refund($id, $by, $note, App::post('disable') === '1');
                Audit::log('shop.refund', $id . ' ' . $note);
                App::redirect($to, $ok ? t('Order marked as refunded. Money is NOT returned automatically; do that in your gateway/bank.') : $msg, $ok ? 'ok' : 'err');
            case 'resend':
                if ($o['status'] !== 'paid' || empty($o['voucher'])) {
                    App::redirect($to, t('Only paid orders with a voucher can be resent.'), 'err');
                }
                $v = $o['voucher'];
                $text = "Voucher " . $o['id'] . "\n" . t('Customer') . ': ' . ($o['customer']['name'] ?? '') . ' ' . ($o['customer']['phone'] ?? '') . "\n"
                    . $o['package']['label'] . "\n" . t('Code') . ': ' . $v['user'] . ($v['pass'] !== $v['user'] ? ' / ' . $v['pass'] : '') . "\n" . $v['url'];
                [$ok, $msg] = Notify::send($text, 'voucher');
                Orders::update($id, function ($x) use ($by, $ok) {
                    Orders::note($x, $by, 'Voucher resent to notification channel: ' . ($ok ? 'ok' : 'failed'));
                    return $x;
                });
                Audit::log('shop.resend', $id);
                App::redirect($to, $ok ? t('Voucher sent to your notification channel.') : t('Not sent: :m', [':m' => $msg]), $ok ? 'ok' : 'err');
            case 'note':
                $text = App::post('note');
                if ($text !== '') {
                    Orders::update($id, function ($x) use ($by, $text) {
                        Orders::note($x, $by, $text);
                        return $x;
                    });
                }
                App::redirect($to, t('Note added.'));
            default:
                App::redirect($to, t('Unknown action.'), 'err');
        }
    }

    public static function export(): void
    {
        $rows = self::filtered();
        $cell = function ($v): string {
            $v = (string)$v;
            if ($v !== '' && strpos("=+-@\t\r", $v[0]) !== false) {
                $v = "'" . $v; // neutralise spreadsheet formulas
            }
            return $v;
        };
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="orders-' . date('Ymd-His') . '.csv"');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, ['order', 'created', 'paid_at', 'status', 'package', 'profile', 'amount', 'name', 'phone', 'email', 'gateway', 'gateway_ref', 'voucher', 'fulfil', 'flag', 'reseller_ref', 'commission'], ',', '"', '');
        foreach ($rows as $o) {
            fputcsv($out, array_map($cell, [
                $o['id'], date('Y-m-d H:i:s', $o['created']), !empty($o['paid_at']) ? date('Y-m-d H:i:s', $o['paid_at']) : '', $o['status'], $o['package']['label'], $o['package']['profile'],
                $o['amount'], $o['customer']['name'] ?? '', $o['customer']['phone'] ?? '', $o['customer']['email'] ?? '', $o['gateway'], $o['ref'], $o['voucher']['user'] ?? '', $o['fulfil'] ?? '', $o['flag'] ?? '',
                $o['attr']['code'] ?? '', !empty($o['attr']['credited_at']) && empty($o['attr']['reversed_at']) ? (int)$o['attr']['comm'] : '',
            ]), ',', '"', '');
        }
        fclose($out);
        exit;
    }
}
