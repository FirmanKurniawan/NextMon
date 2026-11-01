<?php
require_once __DIR__ . '/PaymentGateway.php';

/** Gateway registry + shared HTTP helper. */
final class Payments
{
    public const CLASSES = ['manual' => 'PaymentManual', 'mock' => 'PaymentMock', 'midtrans' => 'PaymentMidtrans', 'tripay' => 'PaymentTripay', 'xendit' => 'PaymentXendit'];

    public static function get(string $id): ?PaymentGateway
    {
        $c = self::CLASSES[$id] ?? null;
        return $c ? new $c() : null;
    }

    /** @return array<string,PaymentGateway> */
    public static function all(): array
    {
        $o = [];
        foreach (self::CLASSES as $id => $c) {
            $o[$id] = new $c();
        }
        return $o;
    }

    /** Request headers, lower-cased keys ("x-callback-signature"). */
    public static function requestHeaders(): array
    {
        $h = [];
        foreach ($_SERVER as $k => $v) {
            if (strncmp($k, 'HTTP_', 5) === 0 && is_string($v)) {
                $h[strtolower(str_replace('_', '-', substr($k, 5)))] = $v;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $h['content-type'] = (string)$_SERVER['CONTENT_TYPE'];
        }
        return $h;
    }

    /**
     * Minimal cURL client. UNVERIFIED against live gateways (written from public docs, never run against them).
     * @return array [int httpCode, ?array json, string raw]
     */
    public static function http(string $method, string $url, array $headers = [], $body = null, ?string $basicUser = null): array
    {
        if (!function_exists('curl_init')) {
            throw new PaymentException('PHP curl extension is required for this gateway');
        }
        $ch = curl_init($url);
        $opt = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $headers,
        ];
        if ($body !== null) {
            $opt[CURLOPT_POSTFIELDS] = $body;
        }
        if ($basicUser !== null) {
            $opt[CURLOPT_USERPWD] = $basicUser . ':';
        }
        curl_setopt_array($ch, $opt);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new PaymentException('Gateway unreachable: ' . $err);
        }
        $j = json_decode((string)$raw, true);
        return [$code, is_array($j) ? $j : null, (string)$raw];
    }
}
