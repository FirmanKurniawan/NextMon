<?php
/**
 * Demo / mock gateway for local testing. Shows a fake pay page (GET /pay/callback?mock=ID&t=TOKEN) whose buttons
 * post a signed webhook (HMAC-SHA256 with a per-install secret) to /pay/callback?g=mock, exercising the real path.
 * Refuses to work in production mode: it would hand out free vouchers.
 */
final class PaymentMock implements PaymentGateway
{
    public function id(): string
    {
        return 'mock';
    }

    public function label(): string
    {
        return t('Demo / mock (testing only)');
    }

    public function fields(): array
    {
        return [];
    }

    public function hasWebhook(): bool
    {
        return true;
    }

    public static function sign(string $orderId, string $status, int $amount, int $ts, string $secret): string
    {
        return hash_hmac('sha256', $orderId . '|' . $status . '|' . $amount . '|' . $ts, $secret);
    }

    public function create(array $order, array $cfg, array $ctx): array
    {
        if (($cfg['env'] ?? 'sandbox') !== 'sandbox') {
            throw new PaymentException('The demo gateway only works in sandbox mode');
        }
        return ['ref' => 'MOCK-' . $order['id'], 'pay_url' => App::url('/pay/callback') . '?mock=' . rawurlencode($order['id']) . '&t=' . rawurlencode($order['token']), 'info' => ''];
    }

    public function detect(array $headers, string $raw): bool
    {
        parse_str($raw, $f);
        return isset($f['mock_sig']);
    }

    public function parseCallback(array $headers, string $raw, array $cfg): array
    {
        if (($cfg['env'] ?? 'sandbox') !== 'sandbox') {
            throw new PaymentException('Mock gateway disabled in production');
        }
        parse_str($raw, $f);
        $secret = (string)($cfg['secret'] ?? '');
        foreach (['order_id', 'status', 'amount', 'ts', 'mock_sig'] as $k) {
            if (!isset($f[$k]) || !is_string($f[$k])) {
                throw new PaymentException('Missing field ' . $k);
            }
        }
        if ($secret === '' || !hash_equals(self::sign($f['order_id'], $f['status'], (int)$f['amount'], (int)$f['ts'], $secret), strtolower($f['mock_sig']))) {
            throw new PaymentException('Bad signature');
        }
        if (abs(time() - (int)$f['ts']) > 900) {
            throw new PaymentException('Stale callback (replay window 15 min)');
        }
        $st = ['paid' => 'paid', 'failed' => 'failed'][$f['status']] ?? null;
        if ($st === null) {
            throw new PaymentException('Unknown status');
        }
        return ['order_id' => $f['order_id'], 'status' => $st, 'amount' => (int)$f['amount'], 'ref' => 'MOCK-' . $f['order_id']];
    }
}
