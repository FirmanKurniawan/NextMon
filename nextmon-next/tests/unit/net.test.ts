import { describe, expect, it } from 'vitest';
import { Net, PEER_HEADER } from '../../src/lib/net.ts';
import { Store } from '../../src/lib/store.ts';

const h = (peer: string | undefined, extra: Record<string, string> = {}) => new Headers({ ...(peer ? { [PEER_HEADER]: peer } : {}), ...extra });

describe('Net.clientIp', () => {
  it('ignores X-Forwarded-For from an untrusted peer (rate-limit bypass)', () => {
    expect(Net.clientIp(h('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9');
  });
  it('honours X-Forwarded-For from loopback, rightmost foreign hop wins', () => {
    expect(Net.clientIp(h('127.0.0.1', { 'x-forwarded-for': '9.9.9.9, 198.51.100.7' }))).toBe('198.51.100.7');
    expect(Net.clientIp(h('::1', { 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(Net.clientIp(h('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.8' }))).toBe('198.51.100.8');
  });
  it('skips configured proxies in the chain; garbage in the chain falls back to the peer', () => {
    process.env.NEXTMON_TRUSTED_PROXIES = '10.0.0.5, 172.18.0.0/16';
    try {
      expect(Net.clientIp(h('10.0.0.5', { 'x-forwarded-for': '198.51.100.9, 172.18.0.3' }))).toBe('198.51.100.9');
      expect(Net.clientIp(h('10.0.0.5', { 'x-forwarded-for': 'not-an-ip' }))).toBe('10.0.0.5');
    } finally {
      delete process.env.NEXTMON_TRUSTED_PROXIES;
    }
  });
  it('without the peer header nothing is trusted (spoofed XFF is useless); a client-sent peer header is overwritten upstream', () => {
    expect(Net.clientIp(h(undefined, { 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
    expect(Net.fromTrustedProxy(h(undefined))).toBe(false);
  });
});

describe('Net.isHttps / hostAllowed / originAllowed', () => {
  it('X-Forwarded-Proto only counts from trusted proxies', () => {
    expect(Net.isHttps(h('127.0.0.1', { 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(Net.isHttps(h('203.0.113.9', { 'x-forwarded-proto': 'https' }))).toBe(false);
    expect(Net.isHttps(h('127.0.0.1'))).toBe(false);
  });
  it('NEXTMON_BASE_URL pins the scheme, the Host and the allowed Origin', () => {
    process.env.NEXTMON_BASE_URL = 'https://nm.example.com';
    try {
      expect(Net.isHttps(h('203.0.113.9'))).toBe(true);
      expect(Net.hostAllowed('nm.example.com')).toBe(true);
      expect(Net.hostAllowed('evil.example.com')).toBe(false);
      expect(Net.originAllowed('https://nm.example.com', 'nm.example.com')).toBe(true);
      expect(Net.originAllowed('https://evil.example.com', 'nm.example.com')).toBe(false);
    } finally {
      delete process.env.NEXTMON_BASE_URL;
    }
  });
  it('rejects header-injection style Host values', () => {
    for (const bad of ['', 'a b', 'a/b', 'a\r\nX: y', 'a"b', 'host:abc', 'a@b.com', '<script>']) expect(Net.hostAllowed(bad)).toBe(false);
    for (const ok of ['localhost', 'localhost:3000', '10.0.0.1:8080', 'nm.example.com', '[::1]:3000']) expect(Net.hostAllowed(ok)).toBe(true);
  });
  it('Origin: same host passes, foreign/garbage fails, absent passes (fetch without Origin)', () => {
    expect(Net.originAllowed('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(Net.originAllowed('http://evil.test', 'localhost:3000')).toBe(false);
    expect(Net.originAllowed('null', 'localhost:3000')).toBe(false);
    expect(Net.originAllowed(null, 'localhost:3000')).toBe(true);
  });
});

describe('Net.hit (fixed window rate limit)', () => {
  it('counts per bucket+key and reports over-limit; buckets are independent', () => {
    const r = Array.from({ length: 5 }, () => Net.hit('t1', 'k', 3, 60));
    expect(r).toEqual([false, false, false, true, true]);
    expect(Net.hit('t1', 'other', 3, 60)).toBe(false);
    expect(Net.hit('t2', 'k', 3, 60)).toBe(false);
  });
  it('expired windows are pruned and reset', () => {
    Net.hit('t3', 'k', 1, 60);
    Store.global('rate_limits').update<Record<string, { n: number; t: number; w: number }>>((a) => {
      a['t3|k']!.t -= 120;
      return a;
    }, {});
    expect(Net.hit('t3', 'k', 1, 60)).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('isPublicIp: loopback, private, link-local, CGNAT, mapped, documentation and reserved ranges are not public', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '2001:db8::1', 'not-an-ip', '']) {
      expect(Net.isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) expect(Net.isPublicIp(ip), ip).toBe(true);
  });
  it('checkOutboundUrl blocks internal targets, odd schemes, credentials and injection', async () => {
    for (const u of ['http://127.0.0.1/x', 'http://10.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://0.0.0.0/', 'file:///etc/passwd', 'ftp://example.com/', 'gopher://x', 'http://user:pw@8.8.8.8/', 'http://8.8.8.8/\r\nHost: x', 'javascript:alert(1)', '', 'http://8.8.8.8\\@127.0.0.1/']) {
      const r = await Net.checkOutboundUrl(u);
      expect(r.ok, u).toBe(false);
    }
  });
  it('accepts public IP literals and returns the vetted addresses to pin; private allowed only with the env switch', async () => {
    const ok = await Net.checkOutboundUrl('https://8.8.8.8:8443/hook');
    expect(ok).toMatchObject({ ok: true, addresses: ['8.8.8.8'] });
    expect((await Net.checkOutboundUrl('http://10.0.0.7/hook')).ok).toBe(false);
    process.env.NEXTMON_ALLOW_PRIVATE_WEBHOOK = '1';
    try {
      expect((await Net.checkOutboundUrl('http://10.0.0.7/hook')).ok).toBe(true);
    } finally {
      delete process.env.NEXTMON_ALLOW_PRIVATE_WEBHOOK;
    }
  });
  it('hostnames that resolve to loopback are blocked (localhost)', async () => {
    expect((await Net.checkOutboundUrl('http://localhost/x')).ok).toBe(false);
  });
});
