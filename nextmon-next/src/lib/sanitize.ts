/**
 * Allow-list HTML sanitiser for voucher / login templates (markup + CSS only, no active content). Port of nextmon-php Sanitize.
 * React already escapes everything it renders; this is ONLY for the places where user-authored HTML is stored and later emitted
 * as raw markup (voucher templates, hotspot login pages) - render the result with dangerouslySetInnerHTML.
 *
 * It rebuilds the markup from a tolerant tokenizer: scripts, frames, forms, event handlers, unknown attributes, `href`, remote
 * CSS (@import, url() other than inline raster images, expression(), behavior...) are dropped; unknown elements are unwrapped.
 * Attribute values are entity-decoded BEFORE they are judged and every `&` is re-escaped on output, so entity tricks
 * (`&lpar;`, `&#x6A;avascript:`) can not smuggle anything past the checks. {{placeholders}} survive (plain text / attribute values).
 */

const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'template', 'noscript', 'audio', 'video', 'source', 'track', 'canvas', 'head', 'title', 'xml', 'svg', 'math']);
const TAGS = new Set(['div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 's', 'strong', 'em', 'small', 'big', 'sub', 'sup', 'center', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'img', 'a', 'pre', 'code', 'label', 'section', 'header', 'footer', 'main', 'article', 'figure', 'figcaption']);
const VOID = new Set(['br', 'hr', 'img', 'col']);
const DROP_VOID = new Set(['embed', 'link', 'meta', 'base', 'source', 'track']); // no end tag: dropping must not swallow the rest
const ATTRS = new Set(['class', 'id', 'style', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'alt', 'title', 'src', 'role', 'color', 'size', 'face', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'dir', 'lang']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]{2,8});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** CSS filter: no escapes, comments, @import, scriptable constructs; url() only for inline raster images. */
export function sanitizeCss(css: string): string {
  let c = css.replace(/\\/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  c = c.replace(/@(import|charset|namespace)\b[^;{]*;?/gi, '');
  c = c.replace(/(expression|behaviou?r|-moz-binding|javascript|vbscript)\s*[:(]?/gi, 'x-blocked');
  c = c.replace(/url\s*\(\s*([^)]*)\)/gi, (_m, u: string) => {
    const v = u.trim().replace(/^['"]+|['"]+$/g, '');
    return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(v) ? `url("${v}")` : 'none';
  });
  return c;
}

function safeSrc(v: string): string {
  const s = v.trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(s) || /^\{\{[a-z_ ]+\}\}$/i.test(s) || /^\/(?!\/)[A-Za-z0-9._~/-]*$/.test(s)) return s;
  return '';
}

type Attr = [string, string];

function parseAttrs(src: string): Attr[] {
  const out: Attr[] = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([m[1]!.toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')]);
  return out;
}

function cleanAttrs(tag: string, attrs: Attr[]): string {
  let o = '';
  const seen = new Set<string>();
  for (const [n, raw] of attrs) {
    if (seen.has(n)) continue;
    let v = raw;
    let keep = ATTRS.has(n) || /^(data|aria)-[a-z0-9-]{1,40}$/.test(n);
    if (n === 'src') {
      v = tag === 'img' ? safeSrc(v) : '';
      keep = v !== '';
    } else if (n === 'style') v = sanitizeCss(v);
    else if (n === 'id' && !/^[A-Za-z][\w-]{0,40}$/.test(v)) keep = false;
    if (keep) {
      seen.add(n);
      o += ` ${n}="${escAttr(v)}"`;
    }
  }
  return o;
}

export function sanitizeTemplateHtml(input: string): string {
  let html = input.replace(/\0/g, '');
  // <style> blocks are kept (sanitised) because templates style themselves with them: pull them out first
  const styles: string[] = [];
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => {
    styles.push(sanitizeCss(css));
    return '';
  });
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<[?!][^>]*>/g, '');

  let out = '';
  const stack: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += escText(html.slice(i));
      break;
    }
    out += escText(html.slice(i, lt));
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(html.slice(lt, lt + 20000));
    if (!m) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (DROP.has(tag)) {
      if (!closing && !DROP_VOID.has(tag) && !/\/\s*$/.test(m[3]!)) {
        const end = new RegExp(`</${tag}\\s*>`, 'i').exec(html.slice(i));
        i = end ? i + end.index + end[0].length : html.length;
      }
      continue;
    }
    if (!TAGS.has(tag)) continue; // unknown element: unwrap (children are processed normally)
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at >= 0) {
        while (stack.length > at) out += `</${stack.pop()}>`;
      }
      continue;
    }
    out += `<${tag}${cleanAttrs(tag, parseAttrs(m[3]!))}>`;
    if (!VOID.has(tag)) stack.push(tag);
  }
  while (stack.length) out += `</${stack.pop()}>`;

  let head = '';
  for (const c of styles) {
    const t = c.trim();
    if (t) head += `<style>${t.replace(/</g, '')}</style>\n`;
  }
  return head + out;
}
