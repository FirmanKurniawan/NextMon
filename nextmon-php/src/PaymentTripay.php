<?php
/**
 * Tripay closed payment. Written from the public docs (tripay.co.id/developer). Signature checks are unit-tested
 * against the documented formulas; the live create call and the amount semantics of the callback
 * (total_amount minus fee_customer) are UNVERIFIED.
 *  create  : POST {tripay.co.id/api-sandbox|api}/transaction/create, Bearer api key,
 *            signature = HMAC-SHA256(merchant_code + merchant_ref + amount, private_key)
 *  webhook : header X-Callback-Signature = HMAC-SHA256(raw JSON body, private_key), header X-Callback-Event: payment_status
 */
final class PaymentTripay implements PaymentGateway
{
    public function id(): string
    {
        return 'tripay';
    }

    public function label(): string
    {
        return 'Tripay';
    }

    public function fields(): array
    {
        return [
            ['key' => 'merchant_code', 'label' => 'Merchant code'],
            ['key' => 'api_key', 'label' => 'API key', 'secret' => true],
            ['key' => 'private_key', 'label' => 'Private key', 'secret' => true],
            ['key' => 'method', 'label' => 'Payment channel code', 'help' => 'e.g. QRIS, BRIVA, MYBVA (see your Tripay channel list)'],
        ];
    }

    public function hasWebhook(): bool
    {
        return true;
    }

    public static function createSignature(string $merchantCode, string $merchantRef, int $amount, string $privateKey): string
    {
        return hash_hmac('sha256', $merchantCode . $merchantRef . $amount, $privateKey);
    }

    public static function callbackSignature(string $rawBody, string $privateKey): string
    {
        return hash_hmac('sha256', $rawBody, $privateKey);
    }

    public function create(array $order, array $cfg, array $ctx): array
    {
        foreach (['merchant_code', 'api_key', 'private_key', 'method'] as $k) {
            if (($cfg[$k] ?? '') === '') {
                throw new PaymentException('Tripay setting missing: ' . $k);
            }
        }
        $base = ($cfg['env'] ?? 'sandbox') === 'production' ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox';
        $cust = (array)($order['customer'] ?? []);
        $amount = (int)$order['amount'];
        $payload = [
            'method' => $cfg['method'],
            'merchant_ref' => $order['id'],
            'amount' => $amount,
            'customer_name' => (string)($cust['name'] ?? 'Customer'),
            'customer_email' => ($cust['email'] ?? '') !== '' ? $cust['email'] : 'noreply@' . preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? 'example.com')),
            'customer_phone' => (string)($cust['phone'] ?? ''),
            'order_items' => [['name' => mb_substr((string)$ctx['item_name'], 0, 60), 'price' => $amount, 'quantity' => 1]],
            'return_url' => $ctx['return_url'],
            'expired_time' => time() + 60 * (int)$ctx['expiry_min'],
            'signature' => self::createSignature($cfg['merchant_code'], $order['id'], $amount, $cfg['private_key']),
        ];
        [$code, $j, $raw] = Payments::http('POST', $base . '/transaction/create', ['Authorization: Bearer ' . $cfg['api_key']], http_build_query($payload));
        if (empty($j['success']) || empty($j['data']['checkout_url'])) {
            throw new PaymentException('Tripay error HTTP ' . $code . ': ' . mb_substr((string)($j['message'] ?? $raw), 0, 160));
        }
        return ['ref' => (string)($j['data']['reference'] ?? ''), 'pay_url' => (string)$j['data']['checkout_url'], 'info' => ''];
    }

    public function detect(array $headers, string $raw): bool
    {
        return isset($headers['x-callback-signature']);
    }

    public function parseCallback(array $headers, string $raw, array $cfg): array
    {
        $key = (string)($cfg['private_key'] ?? '');
        $sig = strtolower((string)($headers['x-callback-signature'] ?? ''));
        if ($key === '' || $sig === '' || !hash_equals(self::callbackSignature($raw, $key), $sig)) {
            throw new PaymentException('Bad signature');
        }
        if (isset($headers['x-callback-event']) && $headers['x-callback-event'] !== 'payment_status') {
            throw new PaymentException('Unsupported event');
        }
        $j = json_decode($raw, true);
        if (!is_array($j) || empty($j['merchant_ref']) || !isset($j['status'])) {
            throw new PaymentException('Invalid payload');
        }
        $map = ['PAID' => 'paid', 'UNPAID' => 'pending', 'EXPIRED' => 'expired', 'FAILED' => 'failed', 'REFUND' => 'refunded'];
        $st = $map[strtoupper((string)$j['status'])] ?? 'pending';
        $amount = (int)($j['total_amount'] ?? 0) - (int)($j['fee_customer'] ?? 0);
        return ['order_id' => (string)$j['merchant_ref'], 'status' => $st, 'amount' => $amount, 'ref' => (string)($j['reference'] ?? '')];
    }
}
