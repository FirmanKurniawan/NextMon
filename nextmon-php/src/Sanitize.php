<?php
/**
 * Allow-list HTML sanitiser for voucher templates (markup + CSS only, no active content).
 * Parses with DOMDocument and rebuilds the tree: unknown attributes, event handlers, scripts, frames, forms, links to
 * script URLs and CSS that can load remote resources are dropped. Without ext-dom everything is escaped (fails closed).
 * {{placeholders}} survive because they are plain text / attribute values.
 */
final class Sanitize
{
    /** removed together with everything inside; every other unknown element is unwrapped (children kept, then cleaned) */
    private const DROP = ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'textarea', 'select', 'option',
        'link', 'meta', 'base', 'template', 'noscript', 'audio', 'video', 'source', 'track', 'canvas', 'head', 'title', 'xml'];
    private const TAGS = ['div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 's', 'strong', 'em', 'small', 'big', 'sub', 'sup', 'center', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'img', 'a', 'pre', 'code', 'label', 'section', 'header', 'footer', 'main', 'article', 'figure', 'figcaption'];
    private const ATTRS = ['class', 'id', 'style', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'alt', 'title', 'src', 'role', 'color', 'size', 'face', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'dir', 'lang'];

    public static function css(string $css): string
    {
        $css = str_replace('\\', '', $css);                                           // no CSS escapes: they hide "url(" / "expression("
        $css = preg_replace('~/\*.*?\*/~s', '', $css);
        $css = preg_replace('/@(import|charset|namespace)\b[^;{]*;?/i', '', $css);
        $css = preg_replace('/(expression|behaviou?r|-moz-binding|javascript|vbscript)\s*[:(]?/i', 'x-blocked', $css);
        // url(): only inline raster images survive
        $css = preg_replace_callback('/url\s*\(\s*([^)]*)\)/i', function ($m) {
            $u = trim($m[1], " \t\r\n'\"");
            return preg_match('~^data:image/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$~i', $u) ? 'url("' . $u . '")' : 'none';
        }, $css);
        return $css;
    }

    private static function src(string $v): string
    {
        $v = trim($v);
        if (preg_match('~^data:image/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$~i', $v) || preg_match('~^\{\{[a-z_ ]+\}\}$~i', $v) || preg_match('#^/(?!/)[A-Za-z0-9._~/\-]*$#', $v)) {
            return $v;
        }
        return '';
    }

    public static function templateHtml(string $html): string
    {
        if (!class_exists('DOMDocument')) {
            return htmlspecialchars($html, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        }
        $html = str_replace("\0", '', $html);
        // <style> blocks are kept (sanitised) because templates style themselves with them: pull them out first
        $styles = [];
        $html = preg_replace_callback('~<style\b[^>]*>(.*?)</style\s*>~is', function ($m) use (&$styles) {
            $styles[] = self::css($m[1]);
            return '';
        }, $html);
        $doc = new DOMDocument('1.0', 'UTF-8');
        $prev = libxml_use_internal_errors(true);
        $doc->loadHTML('<?xml encoding="UTF-8"><body><div id="kl-root">' . $html . '</div></body>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        $root = $doc->getElementById('kl-root');
        if (!$root) {
            return '';
        }
        self::walk($root);
        $out = '';
        foreach ($styles as $c) {
            $c = trim($c);
            if ($c !== '') {
                $out .= '<style>' . str_replace('<', '', $c) . "</style>\n";
            }
        }
        foreach (iterator_to_array($root->childNodes) as $n) {
            $out .= $doc->saveHTML($n);
        }
        return $out;
    }

    private static function walk(DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $c) {
            if ($c instanceof DOMComment || $c instanceof DOMProcessingInstruction || $c instanceof DOMCdataSection) {
                $node->removeChild($c);
                continue;
            }
            if (!$c instanceof DOMElement) {
                continue;
            }
            $tag = strtolower($c->tagName);
            if (in_array($tag, self::DROP, true)) {
                $node->removeChild($c);
                continue;
            }
            self::walk($c);
            if (!in_array($tag, self::TAGS, true)) { // unknown element: keep its (already cleaned) children
                while ($c->firstChild) {
                    $node->insertBefore($c->firstChild, $c);
                }
                $node->removeChild($c);
                continue;
            }
            foreach (iterator_to_array($c->attributes) as $a) {
                $n = strtolower($a->name);
                $v = $a->value;
                $keep = in_array($n, self::ATTRS, true) || (bool)preg_match('/^(data|aria)-[a-z0-9\-]{1,40}$/', $n);
                if ($n === 'src') {
                    $v = $tag === 'img' ? self::src($v) : '';
                    $keep = $v !== '';
                } elseif ($n === 'style') {
                    $v = self::css($v);
                } elseif ($n === 'id' && !preg_match('/^[A-Za-z][\w\-]{0,40}$/', $v)) {
                    $keep = false;
                }
                if (!$keep) {
                    $c->removeAttribute($a->name);
                } elseif ($v !== $a->value) {
                    $c->setAttribute($a->name, $v);
                }
            }
        }
    }
}
