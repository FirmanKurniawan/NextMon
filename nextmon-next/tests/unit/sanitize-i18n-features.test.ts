import { describe, expect, it } from 'vitest';
import { I18n } from '../../src/lib/i18n.ts';
import { sanitizeCss, sanitizeTemplateHtml } from '../../src/lib/sanitize.ts';
import { Features } from '../../src/features/registry.ts';
import { buildNav, tabItems } from '../../src/nav/registry.ts';

describe('sanitizeTemplateHtml', () => {
  it('strips scripts, handlers (incl. svg/onload with slash), frames, forms, js: urls and remote CSS', () => {
    const evil = [
      '<div onmouseover="x()" class="ok">ok</div>',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<img src="javascript:alert(1)">',
      '<img src="http://evil.test/p.png">',
      '<iframe src="http://evil.test"></iframe>',
      '<form action="http://evil.test"><input name=x></form>',
      '<a href="javascript:alert(1)" onclick="x()">link</a>',
      '<div style="background:url(http://evil.test/x.png);width:expression(alert(1))">d</div>',
      '<style>@import url(http://evil.test/a.css); body{background:url(http://evil.test/b.png)}</style>',
      '<div style="background:url&#40;http://evil.test/x&#41;">e</div>',
      '<img src="java&#x73;cript:alert(1)">',
      '<object data="x"></object><embed src="x">',
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
      '<!--[if IE]><script>alert(1)</script><![endif]-->',
      '<div id="a\'b">x</div>',
    ].join('\n');
    const out = sanitizeTemplateHtml(evil);
    for (const bad of ['<script', 'onerror', 'javascript', 'evil.test', '<svg', '<iframe', '<form', '<input', 'onclick', 'expression', '@import', 'onmouseover', '<object', '<embed', 'onload', '<math']) {
      expect(out.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    }
    expect(out).toContain('class="ok"');
  });
  it('keeps layout markup, placeholders, data attributes and unicode; output is well formed', () => {
    const html = '<div class="v" data-qr="{{login_url}}" style="color:#123;width:50%"><h1>{{profile}} ✓ é</h1><table><tr><td colspan="2">{{user}}</td></tr></table><img src="{{logo}}" alt="x"><br><b>bold</b></div>';
    const out = sanitizeTemplateHtml(html);
    for (const keep of ['{{login_url}}', '{{profile}}', '✓ é', 'data-qr', 'colspan="2"', '{{logo}}', '<b>bold</b>', 'color:#123']) expect(out).toContain(keep);
    expect(sanitizeTemplateHtml('<p>unclosed <b>bold')).toBe('<p>unclosed <b>bold</b></p>');
  });
  it('keeps inline raster images (data:image) and local images only', () => {
    expect(sanitizeTemplateHtml('<img src="data:image/png;base64,AAAA==">')).toContain('data:image/png;base64,AAAA==');
    expect(sanitizeTemplateHtml('<img src="/assets/brand/mark-tile.svg">')).toContain('/assets/brand/mark-tile.svg');
    expect(sanitizeTemplateHtml('<img src="//evil.test/x.png">')).not.toContain('evil.test');
    expect(sanitizeTemplateHtml('<img src="data:image/svg+xml;base64,AAAA">')).not.toContain('data:image/svg');
  });
  it('sanitizeCss', () => {
    expect(sanitizeCss('a{background:url("http://x/y.png")}')).toBe('a{background:none}');
    expect(sanitizeCss('a{b:\\75rl(x)}')).not.toContain('\\');
  });
});

describe('i18n', () => {
  it('English is the source language; unknown keys fall back; :params are replaced', () => {
    expect(I18n.translate('en', 'Dashboard')).toBe('Dashboard');
    expect(I18n.translate('id', 'Dashboard')).toBe('Dasbor');
    expect(I18n.translate('id', 'no such key at all')).toBe('no such key at all');
    expect(I18n.translate('en', 'Deleted :n users', { ':n': 3 })).toBe('Deleted 3 users');
  });
  it('ported dictionary has the PHP edition keys (>1000) and the Next-specific ones', () => {
    expect(Object.keys(I18n.dict('id')).length).toBeGreaterThan(1000);
    expect(I18n.translate('id', 'Sign out')).toBe('Keluar');
  });
  it('feature dictionaries are merged without editing core', () => {
    expect(I18n.translate('id', 'Share router')).toBe('Bagikan router'); // from src/features/routers
  });
  it('pick(): cookie beats Accept-Language beats default', () => {
    expect(I18n.pick('en', 'id', 'id')).toBe('en');
    expect(I18n.pick(undefined, 'en-US,en;q=0.9', 'id')).toBe('en');
    expect(I18n.pick(undefined, 'id-ID,id', 'en')).toBe('en'); // no English accept => fallback
    expect(I18n.pick('xx', null, 'id')).toBe('id');
  });
});

describe('feature registry + nav', () => {
  it('no two features claim the same page path, api name, nav key or id', () => {
    expect(Features.conflicts()).toEqual([]);
  });
  it('matches exact paths and :param patterns (exact wins)', () => {
    expect(Features.matchPage('/')?.feature.id).toBe('dashboard');
    expect(Features.matchPage('/hotspot/hosts/')?.feature.id).toBe('hosts');
    expect(Features.matchPage('/nope')).toBeNull();
    expect(Features.apiRoute('dashboard')).not.toBeNull();
    expect(Features.apiRoute('constructor')).toBeNull();
    expect(Features.apiRoute('__proto__')).toBeNull();
  });
  it('nav is filtered by capability, grouped in order, and tab items are limited to 4', () => {
    const all = buildNav(() => true);
    expect(all[0]!.group).toBe('Overview');
    expect(all.flatMap((g) => g.items.map((i) => i.key))).toEqual(expect.arrayContaining(['dashboard', 'hosts']));
    const none = buildNav(() => false);
    expect(none).toEqual([]);
    expect(tabItems(all).length).toBeLessThanOrEqual(4);
  });
});
