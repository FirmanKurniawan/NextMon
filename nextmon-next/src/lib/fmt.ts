/** Small formatting helpers shared by server components and API handlers. */

export function fmtBytes(b: number | string): string {
  let n = Number(b) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : String(Math.trunc(n))) + ' ' + u[i];
}

export function money(n: number | string, currency = 'Rp'): string {
  return currency + ' ' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function ago(ts: number, t: (k: string, p?: Record<string, string | number>) => string, now = Date.now() / 1000): string {
  const d = Math.max(0, now - ts);
  if (d < 60) return t('just now');
  if (d < 3600) return t(':n min ago', { ':n': Math.floor(d / 60) });
  if (d < 86400) return t(':n h ago', { ':n': Math.floor(d / 3600) });
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
