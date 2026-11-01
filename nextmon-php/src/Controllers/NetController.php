<?php
class NetController
{
    // ---- simple queues ----------------------------------------------------------------

    public static function queues(): void
    {
        $rows = App::driver()->print('/queue/simple');
        App::render('queues', ['title' => t('Queues'), 'page' => 'queues', 'rows' => $rows]);
    }

    public static function queueSave(): void
    {
        $r = App::driver();
        $name = App::post('name');
        $target = App::post('target');
        $max = App::post('max_limit', '0/0');
        if (!preg_match('/^[\w.\- ]{1,40}$/', $name) || !preg_match('/^[0-9A-Fa-f:.\/,]+$/', $target) || !preg_match('/^\d+[kMG]?\/\d+[kMG]?$/', $max)) {
            App::redirect('/queues', t('Check name, target (IP/CIDR) and max-limit (example 5M/5M).'), 'err');
        }
        $attrs = ['name' => $name, 'target' => $target, 'max-limit' => $max, 'comment' => App::post('comment')];
        $id = App::post('id');
        $id !== '' ? $r->set('/queue/simple', $id, $attrs) : $r->add('/queue/simple', $attrs);
        Audit::log('queue.save', $name);
        App::redirect('/queues', t('Queue saved.'));
    }

    public static function queueAction(): void
    {
        $r = App::driver();
        $act = App::post('action');
        $n = 0;
        foreach (App::postArr('ids') as $id) {
            if ($act === 'remove') {
                $r->remove('/queue/simple', $id);
            } else {
                $r->set('/queue/simple', $id, ['disabled' => $act === 'disable' ? 'yes' : 'no']);
            }
            $n++;
        }
        Audit::log('queue.' . $act, (string)$n);
        App::redirect('/queues', t('Done: :n queues.', [':n' => $n]));
    }

    // ---- firewall address-list ---------------------------------------------------------------

    public static function firewall(): void
    {
        $r = App::driver();
        $rows = $r->print('/ip/firewall/address-list');
        $hasRule = (bool)$r->print('/ip/firewall/filter', ['comment' => 'nextmon-block'], ['comment']);
        App::render('firewall', ['title' => t('Firewall address list'), 'page' => 'firewall', 'rows' => $rows, 'hasRule' => $hasRule]);
    }

    public static function firewallAdd(): void
    {
        $r = App::driver();
        $list = App::post('list', 'nextmon-block');
        $addr = App::post('address');
        $timeout = strtolower(App::post('timeout'));
        if (!preg_match('/^[\w\-]{1,40}$/', $list) || !preg_match('/^[0-9A-Fa-f:.\/\-]+$/', $addr) || !Scripts::validDuration($timeout)) {
            App::redirect('/firewall', t('Check list name, address and timeout.'), 'err');
        }
        $attrs = ['list' => $list, 'address' => $addr, 'comment' => App::post('comment')];
        if ($timeout !== '') {
            $attrs['timeout'] = $timeout;
        }
        $r->add('/ip/firewall/address-list', $attrs);
        Audit::log('firewall.add', "$list $addr");
        App::redirect('/firewall', t('Address added.'));
    }

    public static function firewallRemove(): void
    {
        $r = App::driver();
        $n = 0;
        foreach (App::postArr('ids') as $id) {
            $r->remove('/ip/firewall/address-list', $id);
            $n++;
        }
        Audit::log('firewall.remove', (string)$n);
        App::redirect('/firewall', t('Done: :n entries.', [':n' => $n]));
    }

    /** Create the drop rule for list "nextmon-block" (forward chain). Move it above other rules on the router if needed. */
    public static function firewallRule(): void
    {
        $r = App::driver();
        if (!$r->print('/ip/firewall/filter', ['comment' => 'nextmon-block'], ['comment'])) {
            $r->add('/ip/firewall/filter', ['chain' => 'forward', 'src-address-list' => 'nextmon-block', 'action' => 'drop', 'comment' => 'nextmon-block']);
        }
        Audit::log('firewall.rule', 'nextmon-block');
        App::redirect('/firewall', t('Drop rule installed. Move it above the hotspot rules if traffic still passes.'));
    }
}
