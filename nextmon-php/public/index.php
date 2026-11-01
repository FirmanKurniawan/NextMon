<?php
/**
 * NextMON front controller.
 *   php -S localhost:8080 -t nextmon-php/public
 * Demo mode: NEXTMON_DEMO=1 php -S localhost:8080 -t nextmon-php/public
 * (A demo router is also created automatically on first run.)
 */
if (PHP_SAPI === 'cli-server') {
    $p = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $f = __DIR__ . str_replace('/', DIRECTORY_SEPARATOR, $p);
    // FRONTEND-PERF: php -S only. Static assets get real cache headers + precompressed (.br/.gz) variants like a production web
    // server would (nginx/Apache/IIS serve /assets directly, see deploy/). Hashed dist files are immutable; others revalidate.
    if (strncmp($p, '/assets/', 8) === 0 && strpos($p, '..') === false && is_file($f) && substr($f, -4) !== '.php') {
        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        $types = ['css' => 'text/css; charset=utf-8', 'js' => 'application/javascript; charset=utf-8', 'json' => 'application/json', 'svg' => 'image/svg+xml',
            'png' => 'image/png', 'ico' => 'image/x-icon', 'webmanifest' => 'application/manifest+json'];
        if (isset($types[$ext])) {
            $hashed = strncmp($p, '/assets/dist/', 13) === 0 && $ext !== 'json';
            $enc = '';
            $ae = $_SERVER['HTTP_ACCEPT_ENCODING'] ?? '';
            if (in_array($ext, ['css', 'js', 'svg'], true)) {
                foreach (['br' => '.br', 'gzip' => '.gz'] as $e => $suf) {
                    if (is_file($f . $suf) && preg_match('/\b' . $e . '\b/', $ae)) {
                        $enc = $e;
                        $f .= $suf;
                        break;
                    }
                }
            }
            $mt = filemtime($f);
            $etag = '"' . dechex($mt) . '-' . dechex((int)filesize($f)) . ($enc ? '-' . $enc : '') . '"';
            header('Content-Type: ' . $types[$ext]);
            header('Cache-Control: ' . ($hashed ? 'public, max-age=31536000, immutable' : 'public, no-cache'));
            header('ETag: ' . $etag);
            header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mt) . ' GMT');
            header('Vary: Accept-Encoding');
            header('X-Content-Type-Options: nosniff');
            if ($enc) {
                header('Content-Encoding: ' . $enc);
            }
            if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
                http_response_code(304);
                exit;
            }
            header('Content-Length: ' . filesize($f));
            readfile($f);
            exit;
        }
    }
    // let the built-in server deliver real static files itself
    if ($p !== '/' && is_file($f) && substr($f, -4) !== '.php') {
        return false;
    }
}
if (version_compare(PHP_VERSION, '8.0.0', '<')) {
    http_response_code(500);
    exit('NextMON needs PHP 8.0+ (8.1 recommended).');
}
require dirname(__DIR__) . '/src/App.php';
App::run();
