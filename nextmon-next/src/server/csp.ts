/**
 * Content-Security-Policy + security headers, built per request (nonce). Used by middleware.ts.
 *
 *  script-src 'self' 'nonce-N' 'strict-dynamic'   no inline scripts without the nonce (Next adds it to its own scripts)
 *  style-src-elem 'self' 'nonce-N'                no inline <style> without the nonce
 *  style-src-attr 'unsafe-inline'                 style="" attributes are used by the shared design system / React style props;
 *                                                 attributes can not run script, this is the standard trade-off
 *  frame-ancestors 'none', form-action 'self', base-uri 'none', object-src 'none'
 */
export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const d = opts.dev;
  const parts = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${d ? " 'unsafe-eval'" : ''}`,
    `style-src 'self'${d ? " 'unsafe-inline'" : ''}`,
    // dev only: Next's dev overlay injects un-nonced <style> tags and a nonce makes 'unsafe-inline' ignored; production keeps the nonce only
    d ? "style-src-elem 'self' 'unsafe-inline'" : `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'" + (d ? ' ws: wss:' : ''),
    "manifest-src 'self'",
    "worker-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (opts.https) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function securityHeaders(https: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(self), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
    'x-permitted-cross-domain-policies': 'none',
  };
  if (https) h['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return h;
}
