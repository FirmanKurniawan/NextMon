<?php
/** Telegram bot + generic webhook sender. Failures never break the request. */
final class Notify
{
    /** Send only if enabled and the event type is subscribed. Events: sale, voucher, router, login */
    public static function event(string $event, string $text): void
    {
        if (Workspace::idOrNull() === null) {
            return;   // no tenant in scope: nobody to notify
        }
        $tg = (array)Store::setting('telegram', []);
        $subscribed = in_array($event, (array)($tg['events'] ?? []), true);
        $anyChannel = !empty($tg['enabled']) || (string)Store::setting('webhook_url', '') !== '';
        if (!$subscribed || !$anyChannel) {
            return;
        }
        self::send($text, $event);
    }

    /** @param array|null $only restrict to channels ['telegram','webhook'] (null = all configured)
     *  @return array [bool ok, string message] */
    public static function send(string $text, string $event = 'test', ?array $only = null): array
    {
        Workspace::id();   // fail closed: the channels and the log below are per workspace
        $tg = (array)Store::setting('telegram', []);
        $hook = (string)Store::setting('webhook_url', '');
        $results = [];
        $ok = false;
        if (($only === null || in_array('telegram', $only, true)) && !empty($tg['enabled']) && !empty($tg['token']) && !empty($tg['chat_id'])) {
            $token = Crypto::decrypt((string)$tg['token']);
            if ($token !== '') {
                [$o, $m] = self::http('https://api.telegram.org/bot' . $token . '/sendMessage', ['chat_id' => $tg['chat_id'], 'text' => $text]);
                $results[] = 'telegram: ' . ($o ? 'ok' : $m);
                $ok = $ok || $o;
            }
        }
        if (($only === null || in_array('webhook', $only, true)) && $hook !== '' && preg_match('#^https?://#i', $hook)) {
            // SSRF guard: the URL is user supplied, so internal / non-public targets are refused and the vetted IP is pinned
            $why = Net::checkOutboundUrl($hook, $pin);
            if ($why !== '') {
                [$o, $m] = [false, 'blocked: ' . $why];
            } else {
                [$o, $m] = self::http($hook, ['event' => $event, 'text' => $text, 'ts' => time(), 'app' => 'nextmon'], $pin);
            }
            $results[] = 'webhook: ' . ($o ? 'ok' : $m);
            $ok = $ok || $o;
        }
        if (!$results) {
            $results[] = 'no channel configured';
        }
        Store::appendLog('notify.log', ['ts' => time(), 'event' => $event, 'text' => mb_substr($text, 0, 300), 'result' => implode('; ', $results), 'ok' => $ok]);
        return [$ok, implode('; ', $results)];
    }

    /** @param string[]|null $pin CURLOPT_RESOLVE entries (host:port:ip) so the request goes to the address we validated */
    private static function http(string $url, array $payload, ?array $pin = null): array
    {
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
        try {
            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => $body,
                    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 5,
                    CURLOPT_CONNECTTIMEOUT => 4,
                    CURLOPT_FOLLOWLOCATION => false,   // a 30x must never bounce us to an internal address
                    CURLOPT_SSL_VERIFYPEER => true,
                    CURLOPT_SSL_VERIFYHOST => 2,
                    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                ]);
                if ($pin) {
                    curl_setopt($ch, CURLOPT_RESOLVE, $pin);
                }
                $res = curl_exec($ch);
                $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $err = curl_error($ch);
                curl_close($ch);
                if ($res === false) {
                    return [false, $err ?: 'curl error'];
                }
                return [$code >= 200 && $code < 300, 'HTTP ' . $code];
            }
            $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => $body, 'timeout' => 5, 'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0]]);
            $res = @file_get_contents($url, false, $ctx);
            if ($res === false) {
                return [false, 'request failed'];
            }
            $code = 0;
            if (!empty($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
                $code = (int)$m[1];
            }
            return [$code >= 200 && $code < 300, 'HTTP ' . $code];
        } catch (Throwable $e) {
            return [false, $e->getMessage()];
        }
    }
}
