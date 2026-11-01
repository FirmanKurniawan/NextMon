<?php
/**
 * Hotspot profile "on-login" script generator + parser (Mikhmon-compatible metadata line).
 *
 * Modes:  rem  = remove user on expiry          remc = rem + record sale
 *         ntf  = keep user, block login (notice) ntfc = ntf + record sale
 *         none = no script
 * Metadata line:  :put (",mode,price,validity,sellingPrice,,lockUser,lockServer,");
 * Sales are written to /system script as   date-|-time-|-user-|-price-|-ip-|-mac-|-validity-|-profile-|-comment
 */
final class Scripts
{
    public const MODES = ['rem', 'ntf', 'remc', 'ntfc', 'none'];

    public static function validDuration(string $v): bool
    {
        return $v === '' || (bool)preg_match('/^(\d{1,9}[wdhms])+$/D', $v); // /D: "$" must not accept a trailing newline (script injection)
    }

    /** "1d2h30m" => seconds (0 when empty/invalid) */
    public static function seconds(string $v): int
    {
        if (!preg_match_all('/(\d+)([wdhms])/', $v, $m, PREG_SET_ORDER)) {
            return 0;
        }
        $mul = ['w' => 604800, 'd' => 86400, 'h' => 3600, 'm' => 60, 's' => 1];
        $t = 0;
        foreach ($m as $x) {
            $t += (int)$x[1] * $mul[$x[2]];
        }
        return $t;
    }

    public static function onLogin(string $mode, string $price, string $validity, string $sprice, bool $lockUser, bool $lockServer, string $profile): string
    {
        if ($mode === 'none' || !in_array($mode, self::MODES, true)) {
            return '';
        }
        $price = preg_replace('/[^0-9]/', '', $price);
        $sprice = preg_replace('/[^0-9]/', '', $sprice === '' ? $price : $sprice);
        $profile = preg_replace('/[^A-Za-z0-9_.\- ]/', '', $profile);
        if (!self::validDuration($validity)) {
            $validity = '';
        }
        $record = substr($mode, -1) === 'c';
        $notice = substr($mode, 0, 3) === 'ntf';

        $expire = $notice
            ? '/ip hotspot active remove [find where user=\"$user\"]; /ip hotspot user set limit-uptime=1s [find where name=\"$user\"]; /system scheduler remove [find where name=\"$user\"]'
            : '/ip hotspot active remove [find where user=\"$user\"]; /ip hotspot user remove [find where name=\"$user\"]; /system scheduler remove [find where name=\"$user\"]';

        $body = '';
        if ($validity !== '') {
            $body .= '/system scheduler add name=$user start-date=$date start-time=$time interval=' . $validity . ' comment="nextmon-expire" on-event="' . $expire . '";' . "\n";
            $body .= ':delay 1s;' . "\n";
            $body .= ':local exp [/system scheduler get [/system scheduler find where name=$user] next-run];' . "\n";
            $body .= ':if ([:len $exp] > 0) do={ /ip hotspot user set comment="$exp $comment" [/ip hotspot user find where name=$user]; };' . "\n";
        }
        if ($lockUser) {
            $body .= '/ip hotspot user set mac-address=$"mac-address" [/ip hotspot user find where name=$user];' . "\n";
        }
        if ($lockServer) {
            $body .= ':local srv [/ip hotspot active get [/ip hotspot active find where user=$user] server];' . "\n";
            $body .= '/ip hotspot user set server=$srv [/ip hotspot user find where name=$user];' . "\n";
        }
        if ($record) {
            $body .= '/system script add name="$date-|-$time-|-$user-|-' . $sprice . '-|-$address-|-$mac-|-' . $validity . '-|-' . $profile . '-|-$comment" owner="$month$year" source="$date" comment="mikhmon";' . "\n";
        }

        $meta = ':put (",' . $mode . ',' . $price . ',' . $validity . ',' . $sprice . ',,' . ($lockUser ? 'Enable' : 'Disable') . ',' . ($lockServer ? 'Enable' : 'Disable') . ',");';
        $guard = $validity !== '' ? ':if ([:len [/system scheduler find where name=$user]] = 0) do={' . "\n" . $body . '}' : $body;

        return $meta . "\n{\n"
            . ':local date [/system clock get date];' . "\n"
            . ':local time [/system clock get time];' . "\n"
            . ':local year [:pick $date 7 11];' . "\n"
            . ':local month [:pick $date 0 3];' . "\n"
            . ':local comment [/ip hotspot user get [/ip hotspot user find where name=$user] comment];' . "\n"
            . ':local mac $"mac-address";' . "\n"
            . $guard . "\n}";
    }

    /** @return array|null [mode, price, validity, sprice, lockUser(bool), lockServer(bool)] */
    public static function parseMeta(string $script): ?array
    {
        if (!preg_match('/:put \(",([a-z]*),([^,]*),([^,]*),([^,]*),[^,]*,([^,]*),?([^,]*),?"\)/', $script, $m)) {
            return null;
        }
        return [
            'mode' => $m[1],
            'price' => $m[2],
            'validity' => $m[3],
            'sprice' => $m[4],
            'lock_user' => $m[5] === 'Enable',
            'lock_server' => $m[6] === 'Enable',
        ];
    }
}
