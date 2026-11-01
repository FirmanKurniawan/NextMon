/**
 * Hotspot profile "on-login" script generator + parser (Mikhmon-compatible metadata line). Port of nextmon-php Scripts.php.
 *
 * Modes:  rem  = remove user on expiry          remc = rem + record sale
 *         ntf  = keep user, block login (notice) ntfc = ntf + record sale
 *         none = no script
 * Metadata line:  :put (",mode,price,validity,sellingPrice,,lockUser,lockServer,");
 * Sales are written to /system script as   date-|-time-|-user-|-price-|-ip-|-mac-|-validity-|-profile-|-comment
 *
 * SECURITY: the output is RouterOS script text. Nothing attacker-controlled is embedded verbatim: the mode is whitelisted, prices are
 * reduced to digits, the validity must match a strict duration grammar (a trailing newline is NOT accepted), and the profile name is
 * reduced to [A-Za-z0-9_. -].
 */
export const MODES = ['rem', 'ntf', 'remc', 'ntfc', 'none'] as const;
export type Mode = (typeof MODES)[number];

export function validDuration(v: string): boolean {
  return v === '' || /^(\d{1,9}[wdhms])+$/.test(v); // JS "$" without the m flag only matches at the very end (no trailing "\n")
}

/** "1d2h30m" => seconds (0 when empty/invalid) */
export function seconds(v: string): number {
  const mul: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let t = 0;
  for (const m of v.matchAll(/(\d+)([wdhms])/g)) t += Number(m[1]) * mul[m[2]!]!;
  return t;
}

export function onLogin(mode: string, price: string, validity: string, sprice: string, lockUser: boolean, lockServer: boolean, profile: string): string {
  if (mode === 'none' || !(MODES as readonly string[]).includes(mode)) return '';
  const pr = price.replace(/[^0-9]/g, '');
  const sp = (sprice === '' ? pr : sprice).replace(/[^0-9]/g, '');
  const prof = profile.replace(/[^A-Za-z0-9_. -]/g, '');
  const val = validDuration(validity) ? validity : '';
  const record = mode.endsWith('c');
  const notice = mode.startsWith('ntf');

  const expire = notice
    ? '/ip hotspot active remove [find where user=\\"$user\\"]; /ip hotspot user set limit-uptime=1s [find where name=\\"$user\\"]; /system scheduler remove [find where name=\\"$user\\"]'
    : '/ip hotspot active remove [find where user=\\"$user\\"]; /ip hotspot user remove [find where name=\\"$user\\"]; /system scheduler remove [find where name=\\"$user\\"]';

  let body = '';
  if (val !== '') {
    body += '/system scheduler add name=$user start-date=$date start-time=$time interval=' + val + ' comment="nextmon-expire" on-event="' + expire + '";\n';
    body += ':delay 1s;\n';
    body += ':local exp [/system scheduler get [/system scheduler find where name=$user] next-run];\n';
    body += ':if ([:len $exp] > 0) do={ /ip hotspot user set comment="$exp $comment" [/ip hotspot user find where name=$user]; };\n';
  }
  if (lockUser) body += '/ip hotspot user set mac-address=$"mac-address" [/ip hotspot user find where name=$user];\n';
  if (lockServer) {
    body += ':local srv [/ip hotspot active get [/ip hotspot active find where user=$user] server];\n';
    body += '/ip hotspot user set server=$srv [/ip hotspot user find where name=$user];\n';
  }
  if (record) {
    body += '/system script add name="$date-|-$time-|-$user-|-' + sp + '-|-$address-|-$mac-|-' + val + '-|-' + prof + '-|-$comment" owner="$month$year" source="$date" comment="mikhmon";\n';
  }

  const meta = ':put (",' + mode + ',' + pr + ',' + val + ',' + sp + ',,' + (lockUser ? 'Enable' : 'Disable') + ',' + (lockServer ? 'Enable' : 'Disable') + ',");';
  const guard = val !== '' ? ':if ([:len [/system scheduler find where name=$user]] = 0) do={\n' + body + '}' : body;

  return (
    meta + '\n{\n' +
    ':local date [/system clock get date];\n' +
    ':local time [/system clock get time];\n' +
    ':local year [:pick $date 7 11];\n' +
    ':local month [:pick $date 0 3];\n' +
    ':local comment [/ip hotspot user get [/ip hotspot user find where name=$user] comment];\n' +
    ':local mac $"mac-address";\n' +
    guard + '\n}'
  );
}

export type Meta = { mode: string; price: string; validity: string; sprice: string; lock_user: boolean; lock_server: boolean };

export function parseMeta(script: string): Meta | null {
  const m = /:put \(",([a-z]*),([^,]*),([^,]*),([^,]*),[^,]*,([^,]*),?([^,]*),?"\)/.exec(script);
  if (!m) return null;
  return { mode: m[1]!, price: m[2]!, validity: m[3]!, sprice: m[4]!, lock_user: m[5] === 'Enable', lock_server: m[6] === 'Enable' };
}

export const Scripts = { MODES, validDuration, seconds, onLogin, parseMeta };
