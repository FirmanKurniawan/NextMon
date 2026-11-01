/** One-shot flash message carried in a short-lived cookie (read and cleared by <Flash/> on the next page). Not a secret. */
export const FLASH_COOKIE = 'nm_flash';

export function flashCookie(msg: string, type: 'ok' | 'err' = 'ok', secure = false): string {
  const v = encodeURIComponent(JSON.stringify([type, msg.slice(0, 400)]));
  return `${FLASH_COOKIE}=${v}; Path=/; Max-Age=60; SameSite=Lax${secure ? '; Secure' : ''}`;
}
