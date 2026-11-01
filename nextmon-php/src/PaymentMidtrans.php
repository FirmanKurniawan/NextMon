<?php
/**
 * Midtrans Snap. Written from the public docs (docs.midtrans.com). The signature check is unit-tested against the
 * documented formula; the live HTTP call (create) is UNVERIFIED - never run against Midtrans.
 *  create : POST {app.sandbox.midtrans.com|app.midtrans.com}/snap/v1/transactions, HTTP Basic (server key as user, empty password)
 *  notify : JSON, signature_key = SHA512(order_id + status_code + gross_amount + server_key)
 * Set "Payment Notification URL" in the Midtrans dashboard to the callback URL shown in /shop/settings.
 */
final class PaymentMidtrans implements PaymentGateway
{
    public function id(): string
    {
        return 'midtrans';
    }

    public function label(): string
    {
        return 'Midtrans Snap';
    }

    public function fields(): array
    {
        return [['key' => 'server_key', 'label' => 'Server key', 'secret' => true, 'help' => 'SB-Mid-server-... (sandbox) / Mid-server-... (production)']];
    }

    public function hasWebhook(): bool
    {
        return true;
    }

    public static function signature(string $orderId, string $statusCode, string $grossAmount, string $serverKey): string
    {
        return hash('sha512', $orderId . $statusCode . $grossAmount . $serverKey);
    }

    public function create(array $order, array $cfg, array $ctx): array
    {
        $key = (string)($cfg['server_key'] ?? '');
        if ($key === '') {
            throw new PaymentException('Midtrans server key is not set');
        }
        $base = ($cfg['env'] ?? 'sandbox') === 'production' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
        $cust = (array)($order['customer'] ?? []);
        $payload = [
            'transaction_details' => ['order_id' => $order['id'], 'gross_amount' => (int)$order['amount']],
            'item_details' => [['id' => (string)$order['package']['id'], 'price' => (int)$order['amount'], 'quantity' => 1, 'name' => mb_substr((string)$ctx['item_name'], 0, 50)]],
            'customer_details' => array_filter(['first_name' => mb_substr((string)($cust['name'] ?? ''), 0, 50), 'email' => $cust['email'] ?? '', 'phone' => $cust['phone'] ?? ''], fn($v) => $v !== ''),
            'expiry' => ['start_time' => date('Y-m-d H:i:s O'), 'unit' => 'minute', 'duration' => (int)$ctx['expiry_min']],
            'callbacks' => ['finish' => $ctx['return_url']],
        ];
        [$code, $j, $raw] = Payments::http('POST', $base . '/snap/v1/transactions', ['Content-Type: application/json', 'Accept: application/json'], json_encode($payload), $key);
        if ($code < 200 || $code >= 300 || empty($j['redirect_url'])) {
            throw new PaymentException('Midtrans error HTTP ' . $code . ': ' . mb_substr((string)($j['error_messages'][0] ?? $raw), 0, 160));
        }
        return ['ref' => (string)($j['token'] ?? ''), 'pay_url' => (string)$j['redirect_url'], 'info' => ''];
    }

    public function detect(array $headers, string $raw): bool
    {
        $j = json_decode($raw, true);
        return is_array($j) && isset($j['signature_key'], $j['order_id'], $j['transaction_status']);
    }

    public function parseCallback(array $headers, string $raw, array $cfg): array
    {
        $j = json_decode($raw, true);
        if (!is_array($j)) {
            throw new PaymentException('Invalid JSON');
        }
        foreach (['order_id', 'status_code', 'gross_amount', 'signature_key', 'transaction_status'] as $k) {
            if (!isset($j[$k]) || !is_string($j[$k])) {
                throw new PaymentException('Missing field ' . $k);
            }
        }
        $key = (string)($cfg['server_key'] ?? '');
        if ($key === '' || !hash_equals(self::signature($j['order_id'], $j['status_code'], $j['gross_amount'], $key), strtolower($j['signature_key']))) {
            throw new PaymentException('Bad signature');
        }
        $ts = $j['transaction_status'];
        $fraud = (string)($j['fraud_status'] ?? 'accept');
        if ($ts === 'settlement' || ($ts === 'capture' && $fraud === 'accept')) {
            $st = 'paid';
        } elseif (in_array($ts, ['deny', 'cancel', 'failure'], true)) {
            $st = 'failed';
        } elseif ($ts === 'expire') {
            $st = 'expired';
        } elseif (in_array($ts, ['refund', 'partial_refund', 'chargeback', 'partial_chargeback'], true)) {
            $st = 'refunded';
        } else {
            $st = 'pending';
        }
        return ['order_id' => $j['order_id'], 'status' => $st, 'amount' => (int)round((float)$j['gross_amount']), 'ref' => (string)($j['transaction_id'] ?? '')];
    }
}
