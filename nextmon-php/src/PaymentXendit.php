<?php
/**
 * Xendit Invoice. Written from the public docs (docs.xendit.co). The callback-token check is unit-tested;
 * the live create call is UNVERIFIED. Xendit has one base URL; sandbox vs production is decided by the secret key
 * (xnd_development_... / xnd_production_...), the env switch here only guards against a mismatched key.
 *  create  : POST https://api.xendit.co/v2/invoices, HTTP Basic (secret key as user)
 *  webhook : header x-callback-token must equal the "Callback verification token" from the Xendit dashboard
 */
final class PaymentXendit implements PaymentGateway
{
    public function id(): string
    {
        return 'xendit';
    }

    public function label(): string
    {
        return 'Xendit Invoice';
    }

    public function fields(): array
    {
        return [
            ['key' => 'secret_key', 'label' => 'Secret API key', 'secret' => true],
            ['key' => 'callback_token', 'label' => 'Callback verification token', 'secret' => true],
        ];
    }

    public function hasWebhook(): bool
    {
        return true;
    }

    public static function tokenValid(string $headerToken, string $configured): bool
    {
        return $configured !== '' && $headerToken !== '' && hash_equals($configured, $headerToken);
    }

    public function create(array $order, array $cfg, array $ctx): array
    {
        $key = (string)($cfg['secret_key'] ?? '');
        if ($key === '') {
            throw new PaymentException('Xendit secret key is not set');
        }
        $isProdKey = strpos($key, 'xnd_production_') === 0;
        if ((($cfg['env'] ?? 'sandbox') === 'production') !== $isProdKey) {
            throw new PaymentException('Xendit key does not match the selected environment');
        }
        $cust = (array)($order['customer'] ?? []);
        $payload = array_filter([
            'external_id' => $order['id'],
            'amount' => (int)$order['amount'],
            'currency' => 'IDR',
            'description' => mb_substr((string)$ctx['item_name'], 0, 100),
            'payer_email' => $cust['email'] ?? '',
            'invoice_duration' => 60 * (int)$ctx['expiry_min'],
            'success_redirect_url' => $ctx['return_url'],
            'failure_redirect_url' => $ctx['return_url'],
            'customer' => array_filter(['given_names' => (string)($cust['name'] ?? ''), 'mobile_number' => (string)($cust['phone'] ?? '')]),
        ], fn($v) => $v !== '' && $v !== []);
        [$code, $j, $raw] = Payments::http('POST', 'https://api.xendit.co/v2/invoices', ['Content-Type: application/json'], json_encode($payload), $key);
        if ($code < 200 || $code >= 300 || empty($j['invoice_url'])) {
            throw new PaymentException('Xendit error HTTP ' . $code . ': ' . mb_substr((string)($j['message'] ?? $raw), 0, 160));
        }
        return ['ref' => (string)($j['id'] ?? ''), 'pay_url' => (string)$j['invoice_url'], 'info' => ''];
    }

    public function detect(array $headers, string $raw): bool
    {
        return isset($headers['x-callback-token']);
    }

    public function parseCallback(array $headers, string $raw, array $cfg): array
    {
        if (!self::tokenValid((string)($headers['x-callback-token'] ?? ''), (string)($cfg['callback_token'] ?? ''))) {
            throw new PaymentException('Bad callback token');
        }
        $j = json_decode($raw, true);
        if (!is_array($j) || empty($j['external_id']) || !isset($j['status'])) {
            throw new PaymentException('Invalid payload');
        }
        $map = ['PAID' => 'paid', 'SETTLED' => 'paid', 'PENDING' => 'pending', 'EXPIRED' => 'expired', 'FAILED' => 'failed'];
        $st = $map[strtoupper((string)$j['status'])] ?? 'pending';
        return ['order_id' => (string)$j['external_id'], 'status' => $st, 'amount' => (int)round((float)($j['amount'] ?? 0)), 'ref' => (string)($j['id'] ?? '')];
    }
}
