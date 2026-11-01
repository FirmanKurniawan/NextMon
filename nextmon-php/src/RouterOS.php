<?php
/**
 * Minimal RouterOS API client (plain 8728 / SSL 8729).
 * Word encoding per https://wiki.mikrotik.com/wiki/Manual:API
 * Login: v6.43+ plain; falls back to legacy MD5 challenge when the router answers with =ret=.
 *
 * Speed features (all opt-in through App::driver(), the class defaults stay the classic behaviour):
 *   - lazy connect  : setCredentials() connects on the first command only
 *   - persistence   : the logged-in socket survives between PHP requests of one process (enablePersistence)
 *   - pipelining    : several independent commands share one round-trip via API tags (pipeline / printMany / addMany ...)
 *   - circuit breaker: after a failed connect/login further attempts fail instantly for a few seconds (enableBreaker)
 * NOTE: written without being able to run PHP on the dev machine - verified only against fake servers, never a real router.
 */
require_once __DIR__ . '/Driver.php';

class RouterOS implements Driver
{
    private $sock = null;
    private string $host;
    private int $port;
    private bool $ssl;
    private int $timeout;
    private int $connectTimeout;
    private bool $verifyTls;
    private ?string $user = null;
    private string $pass = '';
    private bool $ready = false;       // logged in (a dead connection may be re-established transparently)
    private float $deadline = 0.0;     // wall-clock limit of the current exchange (slow-drip protection)
    private int $got = 0;              // bytes received in the current exchange
    private bool $persist = false;     // keep the authenticated socket alive between PHP requests (see enablePersistence)
    private int $keepalive = 60;       // max idle seconds before a persistent socket is no longer trusted
    private bool $breaker = false;     // fail fast after a recent connect/login failure (see enableBreaker)
    private int $breakerTtl = 15;
    private ?string $failMsg = null;  // why the last connect() failed
    private bool $reused = false;     // current socket came from the persistent pool and has not completed an exchange yet
    private string $tagPrefix = '';
    private int $tagSeq = 0;
    /** counters for tests / diagnostics (this object only) */
    public int $stat_connects = 0;
    public int $stat_logins = 0;
    public int $stat_exchanges = 0;

    /** one word / one whole reply are capped so a broken or hostile peer cannot exhaust PHP memory */
    public const MAX_WORD = 8388608;
    public const MAX_REPLY = 67108864;
    public const MAX_ROWS = 200000;
    /** sentences sent per pipelined write; a failed chunk stops the remaining chunks (see addMany) */
    public const PIPE_CHUNK = 100;

    /** attributes of the last !done sentence (e.g. ret=*1F after add) */
    public array $lastDone = [];

    /**
     * @param bool $verifyTls validate the api-ssl certificate chain + host name (needs a real certificate on the router;
     *                        RouterOS's default anonymous-DH setup cannot be verified, hence off by default)
     */
    public function __construct(string $host, int $port = 8728, bool $ssl = false, int $timeout = 5, bool $verifyTls = false)
    {
        $this->verifyTls = $verifyTls;
        $this->host = $host;
        $this->port = $port;
        $this->ssl = $ssl;
        $this->timeout = $timeout;
        $this->connectTimeout = $timeout;
        $this->tagPrefix = bin2hex(random_bytes(3));
    }

    public function isDemo(): bool
    {
        return false;
    }

    public function setTimeout(int $seconds): void
    {
        $this->timeout = $seconds;
        if ($this->sock) {
            stream_set_timeout($this->sock, $seconds);
        }
    }

    /** Separate (usually shorter) limit for the TCP/TLS handshake; reads keep using setTimeout(). */
    public function setConnectTimeout(int $seconds): void
    {
        $this->connectTimeout = max(1, $seconds);
    }

    /**
     * Keep the logged-in socket open for the next PHP request of this process (php -S, php-fpm / Apache worker): saves the
     * TCP handshake + login (2 round-trips; more with TLS) per page. A pooled socket is only reused when it is provably ours,
     * idle < $keepaliveSec, same credentials, and has no unread bytes; anything else is dropped and re-established.
     */
    public function enablePersistence(int $keepaliveSec = 60): void
    {
        $this->persist = $keepaliveSec > 0;
        $this->keepalive = max(1, $keepaliveSec);
    }

    /** After a failed connect/login, further attempts to the same host:port fail immediately for $ttl seconds (shared via Cache). */
    public function enableBreaker(int $ttl = 15): void
    {
        $this->breaker = $ttl > 0;
        $this->breakerTtl = max(1, $ttl);
    }

    /** Store credentials without connecting: the first command connects (lazy), so pages that never need the router cost nothing. */
    public function setCredentials(string $user, string $pass): void
    {
        $this->user = $user;
        $this->pass = $pass;
    }

    private function breakerKey(): string
    {
        return 'cb:' . $this->host . ':' . $this->port . ':' . (int)$this->ssl;
    }

    private function breakerCheck(): void
    {
        if (!$this->breaker) {
            return;
        }
        $v = Cache::get($this->breakerKey());
        if (is_array($v)) {
            $left = max(1, (int)($v['until'] - time()));
            throw new RouterOSException((string)$v['msg'] . ' [router marked unreachable, retry in ' . $left . 's]');
        }
    }

    private function breakerTrip(string $msg): void
    {
        if ($this->breaker) {
            Cache::set($this->breakerKey(), ['until' => time() + $this->breakerTtl, 'msg' => $msg], $this->breakerTtl);
        }
    }

    // ---- persistent socket bookkeeping ------------------------------------------------------

    private function markerFile(): string
    {
        return Store::dir() . '/cache/rc-' . substr(hash('sha256', $this->host . '|' . $this->port . '|' . (int)$this->ssl . '|' . $this->user . '|' . getmypid()), 0, 24) . '.json';
    }

    private function passDigest(): string
    {
        // tenant-ok: the platform data key (one key protects every workspace by design)
        return substr(hash_hmac('sha256', $this->pass, (string)@file_get_contents(Store::path('secret.key'))), 0, 24);
    }

    private function readMarker(): ?array
    {
        $j = json_decode((string)@file_get_contents($this->markerFile()), true);
        return is_array($j) ? $j : null;
    }

    private function writeMarker(): void
    {
        $name = $this->sock ? (string)@stream_socket_get_name($this->sock, false) : '';
        if ($name === '') {
            return;
        }
        @file_put_contents($this->markerFile(), json_encode(['pid' => getmypid(), 'local' => $name, 't' => time(), 'pk' => $this->passDigest()]));
        if (random_int(1, 100) === 1) { // markers of dead workers
            foreach (glob(Store::dir() . '/cache/rc-*.json') ?: [] as $f) {   // tenant-ok: pooled-socket markers keyed by device + credentials, no tenant data
                if (time() - (int)@filemtime($f) > 3600) {
                    @unlink($f);
                }
            }
        }
    }

    private function dropMarker(): void
    {
        if ($this->persist && $this->user !== null) {
            @unlink($this->markerFile());
        }
    }

    private function readable($s): bool
    {
        $r = [$s];
        $w = $e = null;
        return @stream_select($r, $w, $e, 0) !== 0;   // readable on an idle API socket = EOF, RST or unread junk: not reusable
    }

    private function open(bool $persistent)
    {
        $opts = [];
        if ($this->ssl && $this->verifyTls) {
            $opts['ssl'] = ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $this->host, 'allow_self_signed' => false];
        } elseif ($this->ssl) {
            // RouterOS api-ssl often uses anonymous DH without a certificate: encrypted but NOT authenticated (opt in to verify_tls)
            $opts['ssl'] = [
                'verify_peer' => false,
                'verify_peer_name' => false,
                'allow_self_signed' => true,
                'ciphers' => 'ADH:ALL@SECLEVEL=0',
            ];
        }
        $ctx = stream_context_create($opts);
        $errno = 0;
        $errstr = '';
        $scheme = $this->ssl ? 'ssl' : 'tcp';
        $flags = STREAM_CLIENT_CONNECT | ($persistent ? STREAM_CLIENT_PERSISTENT : 0);
        $s = @stream_socket_client($scheme . '://' . $this->host . ':' . $this->port, $errno, $errstr, $this->connectTimeout, $flags, $ctx);
        if (!$s) {
            $msg = 'Cannot connect to ' . $this->host . ':' . $this->port . ' (' . ($errstr ?: 'error ' . $errno) . ')';
            $this->breakerTrip($msg);
            throw new RouterOSException($msg);
        }
        $this->stat_connects++;
        stream_set_timeout($s, $this->timeout);
        return $s;
    }

    public function connect(string $user, string $pass): void
    {
        $this->close();
        $this->user = null;
        $this->pass = '';
        $this->failMsg = null;
        try {
            $this->breakerCheck();
            $this->connectNow($user, $pass);
        } catch (RouterOSException $e) {
            $this->failMsg = $e->getMessage();   // later commands in this request fail the same way, instantly
            $this->user = null;
            $this->pass = '';
            throw $e;
        }
    }

    private function connectNow(string $user, string $pass): void
    {
        $this->user = $user;   // kept (in memory only) so a dead connection can be re-established; wiped again on failure
        $this->pass = $pass;
        $this->reused = false;
        $this->got = 0;

        $ambiguous = false;   // pooled socket of unknown history (no marker): if logging in on it fails, retry once on a brand-new one
        if ($this->persist) {
            $m = $this->readMarker();
            $s = $this->open(true);
            $local = (string)@stream_socket_get_name($s, false);
            $fresh = $m === null || ($m['local'] ?? '') !== $local;
            if (!$fresh) {
                $ok = ($m['pid'] ?? 0) === getmypid() && ($m['pk'] ?? '') === $this->passDigest()
                    && time() - (int)($m['t'] ?? 0) <= $this->keepalive && !$this->readable($s);
                if ($ok) {
                    $this->sock = $s;
                    $this->ready = true;
                    $this->reused = true;
                    stream_set_timeout($s, $this->timeout);
                    if (time() - (int)$m['t'] > 15) {
                        $this->writeMarker();
                    }
                    return;
                }
                @fclose($s);                // known leftover that we may not trust: really close it and start clean
                $s = $this->open(true);
            } elseif ($this->readable($s)) {
                @fclose($s);                // unknown leftover with pending bytes
                $s = $this->open(true);
            } else {
                $ambiguous = true;
            }
        } else {
            $s = $this->open(false);
        }
        $this->sock = $s;

        try {
            try {
                $this->login();
            } catch (RouterOSException $e) {
                if (!$ambiguous) {
                    throw $e;
                }
                $this->close();
                $this->sock = $this->open(true);
                $this->login();
            }
            $this->ready = true;
            if ($this->persist) {
                $this->writeMarker();
            }
        } catch (RouterOSException $e) {
            $this->close();   // never leave a half-authenticated socket (or the password) around after a failed login
            $this->user = null;
            $this->pass = '';
            $this->breakerTrip($e->getMessage());
            throw $e;
        }
    }

    private function login(): void
    {
        $this->stat_logins++;
        // v6.43+ plain login
        $this->talk(['/login', '=name=' . $this->user, '=password=' . $this->pass]);
        $ret = $this->lastDone['ret'] ?? null;
        if ($ret !== null && strlen($ret) === 32 && ctype_xdigit($ret)) {
            // legacy challenge-response
            $resp = '00' . md5("\0" . $this->pass . hex2bin($ret));
            $this->talk(['/login', '=name=' . $this->user, '=response=' . $resp]);
        }
    }

    private function reconnect(): void
    {
        if ($this->user === null) {
            throw new RouterOSException('Not connected to the router');
        }
        $this->connect($this->user, $this->pass);
    }

    /** Close for good (also removes a persistent socket from the pool). */
    public function close(): void
    {
        $this->ready = false;
        $this->reused = false;
        if ($this->sock) {
            $this->dropMarker();
            @fclose($this->sock);
            $this->sock = null;
        }
    }

    /** Detach from the socket without closing it (the persistent pool keeps it for the next request). */
    public function release(): void
    {
        $this->sock = null;
        $this->ready = false;
    }

    public function __destruct()
    {
        if ($this->sock) {
            if ($this->persist && $this->ready) {
                $this->release();
                return;
            }
            try {
                $this->writeSentence(['/quit']);
            } catch (Throwable $e) {
                // ignore
            }
            $this->close();
        }
    }

    // ---- helper methods (Driver) -------------------------------------------------

    /** Words of a print command (shared by print() and printMany()). */
    private function printWords(string $path, array $query, array $props): array
    {
        $w = [$this->cmd($path, 'print')];
        if ($props) {
            $w[] = '=.proplist=' . implode(',', array_values(array_unique(array_merge(['.id'], $props))));
        }
        foreach ($query as $k => $v) {
            $w[] = '?' . self::key($k) . '=' . $this->val($v);
        }
        return $w;
    }

    private function addWords(string $path, array $attrs): array
    {
        $w = [$this->cmd($path, 'add')];
        foreach ($attrs as $k => $v) {
            $w[] = '=' . self::key($k) . '=' . $this->val($v);
        }
        return $w;
    }

    private function setWords(string $path, string $id, array $attrs): array
    {
        $w = [$this->cmd($path, 'set'), '=.id=' . $id];
        foreach ($attrs as $k => $v) {
            $w[] = '=' . self::key($k) . '=' . $this->val($v);
        }
        return $w;
    }

    public function print(string $path, array $query = [], array $props = []): array
    {
        return $this->talk($this->printWords($path, $query, $props));
    }

    public function add(string $path, array $attrs): string
    {
        $this->talk($this->addWords($path, $attrs));
        return (string)($this->lastDone['ret'] ?? '');
    }

    public function set(string $path, string $id, array $attrs): void
    {
        $this->talk($this->setWords($path, $id, $attrs));
    }

    public function remove(string $path, string $id): void
    {
        $this->talk([$this->cmd($path, 'remove'), '=.id=' . $id]);
    }

    public function command(string $path, array $attrs = [], array $query = []): array
    {
        $w = [self::path($path)];
        foreach ($attrs as $k => $v) {
            $w[] = '=' . self::key($k) . '=' . $this->val($v);
        }
        foreach ($query as $k => $v) {
            $w[] = '?' . self::key($k) . '=' . $this->val($v);
        }
        return $this->talk($w);
    }

    // ---- pipelined (tagged) variants: N independent commands, ONE round-trip ---------------------

    /**
     * Run several prints concurrently. $reqs = [key => [path, query?, props?]]; returns [key => rows] in the same order.
     * The first RouterOS error (after every reply has been read, so the connection stays in sync) is thrown.
     */
    public function printMany(array $reqs): array
    {
        $keys = array_keys($reqs);
        $sent = [];
        foreach ($reqs as $r) {
            $sent[] = $this->printWords((string)$r[0], (array)($r[1] ?? []), (array)($r[2] ?? []));
        }
        $res = $this->pipeline($sent);
        $out = [];
        foreach ($keys as $i => $k) {
            if ($res[$i]['trap'] !== null) {
                throw new RouterOSException($res[$i]['trap']);
            }
            $out[$k] = $res[$i]['rows'];
        }
        return $out;
    }

    /**
     * Add many rows with one write per chunk of PIPE_CHUNK. Returns the new .id values in order. When a chunk reports an
     * error the later chunks are not sent and the error is thrown (rows of the failed chunk that succeeded stay on the router,
     * exactly like a one-by-one loop that stops at the first failure would leave them, give or take the rest of that chunk).
     * @param array[] $rows attribute maps
     */
    public function addMany(string $path, array $rows): array
    {
        $ids = [];
        foreach (array_chunk(array_values($rows), self::PIPE_CHUNK) as $chunk) {
            $res = $this->pipeline(array_map(fn($a) => $this->addWords($path, $a), $chunk));
            foreach ($res as $r) {
                if ($r['trap'] !== null) {
                    throw new RouterOSException($r['trap']);
                }
                $ids[] = (string)($r['done']['ret'] ?? '');
            }
        }
        return $ids;
    }

    /** @param string[] $ids */
    public function removeMany(string $path, array $ids): void
    {
        foreach (array_chunk(array_values($ids), self::PIPE_CHUNK) as $chunk) {
            $res = $this->pipeline(array_map(fn($id) => [$this->cmd($path, 'remove'), '=.id=' . $id], $chunk));
            foreach ($res as $r) {
                if ($r['trap'] !== null) {
                    throw new RouterOSException($r['trap']);
                }
            }
        }
    }

    /** @param array<string,array> $changes id => attrs */
    public function setMany(string $path, array $changes): void
    {
        $sent = [];
        foreach ($changes as $id => $attrs) {
            $sent[] = $this->setWords($path, (string)$id, $attrs);
        }
        foreach (array_chunk($sent, self::PIPE_CHUNK) as $chunk) {
            foreach ($this->pipeline($chunk) as $r) {
                if ($r['trap'] !== null) {
                    throw new RouterOSException($r['trap']);
                }
            }
        }
    }

    /**
     * Like addMany() but never throws for a row: every chunk is sent, each row reports ['id' => string, 'err' => ?string].
     * For bulk imports that want per-row error reporting.
     * @return array[] same order as $rows
     */
    public function addTry(string $path, array $rows): array
    {
        $out = [];
        foreach (array_chunk(array_values($rows), self::PIPE_CHUNK) as $chunk) {
            foreach ($this->pipeline(array_map(fn($a) => $this->addWords($path, $a), $chunk)) as $r) {
                $out[] = ['id' => (string)($r['done']['ret'] ?? ''), 'err' => $r['trap']];
            }
        }
        return $out;
    }

    /** @param array[] $changes list of [id, attrs]; @return array[] list of ['err' => ?string] */
    public function setTry(string $path, array $changes): array
    {
        $out = [];
        foreach (array_chunk(array_values($changes), self::PIPE_CHUNK) as $chunk) {
            foreach ($this->pipeline(array_map(fn($c) => $this->setWords($path, (string)$c[0], (array)$c[1]), $chunk)) as $r) {
                $out[] = ['err' => $r['trap']];
            }
        }
        return $out;
    }

    /** Run the same command for many attribute sets (e.g. reset-counters per user) in one round-trip per chunk. */
    public function commandMany(string $path, array $attrList): void
    {
        $p = self::path($path);
        $sent = [];
        foreach ($attrList as $attrs) {
            $w = [$p];
            foreach ($attrs as $k => $v) {
                $w[] = '=' . self::key($k) . '=' . $this->val($v);
            }
            $sent[] = $w;
        }
        foreach (array_chunk($sent, self::PIPE_CHUNK) as $chunk) {
            foreach ($this->pipeline($chunk) as $r) {
                if ($r['trap'] !== null) {
                    throw new RouterOSException($r['trap']);
                }
            }
        }
    }

    private function cmd(string $path, string $verb): string
    {
        return self::path($path) . '/' . $verb;
    }

    /** Command paths and attribute names come from code, never from users; refuse anything that could smuggle words. */
    private static function path(string $path): string
    {
        $p = '/' . trim(str_replace(' ', '/', $path), '/');
        if (!preg_match('~^(/[A-Za-z0-9_\-]+)+$~D', $p)) {
            throw new RouterOSException('Invalid command path');
        }
        return $p;
    }

    private static function key($k): string
    {
        $k = (string)$k;
        if (!preg_match('/^[A-Za-z0-9_.\-]{1,64}$/D', $k)) {
            throw new RouterOSException('Invalid attribute name');
        }
        return $k;
    }

    private function val($v): string
    {
        if ($v === true) {
            return 'yes';
        }
        if ($v === false) {
            return 'no';
        }
        return (string)$v;
    }

    // ---- protocol ----------------------------------------------------------------

    /** Send a sentence, collect !re rows until !done. Throws on !trap / !fatal. */
    public function talk(array $words): array
    {
        $r = $this->exchange([$words])[0];
        $this->lastDone = $r['done'];
        if ($r['trap'] !== null) {
            throw new RouterOSException($r['trap']);
        }
        return $r['rows'];
    }

    /**
     * Send several independent sentences in one write (each gets its own .tag) and read all replies.
     * @param array[] $sentences word lists
     * @return array[] per sentence: ['rows' => [...], 'done' => [...], 'trap' => ?string] (traps are returned, not thrown)
     */
    public function pipeline(array $sentences): array
    {
        if (!$sentences) {
            return [];
        }
        $sentences = array_values($sentences);
        return $this->exchange($sentences);
    }

    private function isRead(array $words): bool
    {
        $c = (string)($words[0] ?? '');
        return substr($c, -6) === '/print' || substr($c, -7) === '/getall';
    }

    /**
     * One write, then read until every sentence is answered. A transport failure on a reused (pooled) socket before any byte
     * came back is retried once on a fresh connection when everything sent was a read (nothing can have been executed twice).
     */
    private function exchange(array $sentences): array
    {
        $login = ($sentences[0][0] ?? '') === '/login';
        if ($this->sock === null && $this->user === null && $this->failMsg !== null && !$login) {
            throw new RouterOSException($this->failMsg);
        }
        if ($this->sock === null && $this->user !== null && !$login) {
            $this->reconnect();   // lazy first use, or after !fatal / an idle timeout on the router side
        }
        $tags = [];
        $out = '';
        foreach ($sentences as $i => $words) {
            if ($login) {
                $tags[$i] = null;   // the login exchange is never tagged (old fake servers / routers echo nothing useful)
            } else {
                $tags[$i] = $this->tagPrefix . '.' . (++$this->tagSeq);
                $words[] = '.tag=' . $tags[$i];
            }
            $out .= $this->encodeSentence($words);
        }
        $allReads = true;
        foreach ($sentences as $w) {
            $allReads = $allReads && $this->isRead($w);
        }
        $wasReused = $this->reused;
        try {
            try {
                $this->writeRaw($out);
            } catch (RouterOSException $e) {
                // the request never (fully) left this host, so it is safe to retry once on a fresh connection
                if ($login || $this->user === null) {
                    throw $e;
                }
                $this->close();
                $this->reconnect();
                $this->reused = false;
                $wasReused = false;
                $this->writeRaw($out);
            }
            $this->stat_exchanges++;
            return $this->collect($tags);
        } catch (RouterOSException $e) {
            if ($wasReused && $allReads && $this->got === 0 && !$login && $this->user !== null && $this->isTransport($e)) {
                $this->close();
                $this->reconnect();
                $this->writeRaw($out);
                $this->stat_exchanges++;
                return $this->collect($tags);
            }
            throw $e;
        } finally {
            $this->reused = false;
        }
    }

    private function isTransport(RouterOSException $e): bool
    {
        $m = $e->getMessage();
        return str_starts_with($m, 'Connection closed by router') || str_starts_with($m, 'Write to router failed') || str_starts_with($m, 'Not connected');
    }

    /** @param array<int,?string> $tags tag of each outstanding sentence (null = untagged single login sentence) */
    private function collect(array $tags): array
    {
        $n = count($tags);
        $res = [];
        $byTag = [];
        foreach ($tags as $i => $t) {
            $res[$i] = ['rows' => [], 'done' => [], 'trap' => null, 'fin' => false];
            if ($t !== null) {
                $byTag[$t] = $i;
            }
        }
        $left = $n;
        $this->lastDone = [];
        $this->got = 0;
        $this->deadline = microtime(true) + max(30, $this->timeout * 2);
        while ($left > 0) {
            $s = $this->readSentence();
            if (!$s) {
                if (microtime(true) > $this->deadline) {
                    $this->close();
                    throw new RouterOSException('Router read timeout');
                }
                continue;
            }
            $type = array_shift($s);
            $attrs = [];
            $tag = null;
            foreach ($s as $w) {
                if ($w === '') {
                    continue;
                }
                if ($w[0] === '=') {
                    $p = strpos($w, '=', 1);
                    if ($p === false) {
                        $attrs[substr($w, 1)] = '';
                    } else {
                        $attrs[substr($w, 1, $p - 1)] = substr($w, $p + 1);
                    }
                } elseif (strncmp($w, '.tag=', 5) === 0) {
                    $tag = substr($w, 5);
                }
            }
            if ($type === '!fatal') {
                $this->close();
                throw new RouterOSException('Router closed connection: ' . ($s[0] ?? 'fatal'));
            }
            if ($tag !== null) {
                if (!isset($byTag[$tag])) {
                    continue;   // leftover of an earlier, abandoned command on a reused socket: not ours
                }
                $i = $byTag[$tag];
            } else {
                $i = $n === 1 ? 0 : null;
                if ($i === null) {
                    continue;   // untagged chatter while a pipeline is in flight
                }
            }
            if ($res[$i]['fin']) {
                continue;
            }
            if ($type === '!re') {
                if (count($res[$i]['rows']) >= self::MAX_ROWS) {
                    $this->close();   // the rest of the reply is still in flight: this connection is unusable now
                    throw new RouterOSException('Router reply too large');
                }
                $res[$i]['rows'][] = $attrs;
            } elseif ($type === '!done') {
                $res[$i]['done'] = $attrs;
                $res[$i]['fin'] = true;
                $left--;
            } elseif ($type === '!trap') {
                $res[$i]['trap'] ??= $attrs['message'] ?? 'RouterOS error';
            }
        }
        foreach ($res as $i => $r) {
            unset($res[$i]['fin']);
        }
        if ($n === 1) {
            $this->lastDone = $res[0]['done'];
        } else {
            $last = end($res);
            $this->lastDone = $last ? $last['done'] : [];
        }
        return $res;
    }

    private function encodeSentence(array $words): string
    {
        $out = '';
        foreach ($words as $w) {
            $w = (string)$w;
            $out .= self::encLen(strlen($w)) . $w;
        }
        return $out . "\0";
    }

    private function writeSentence(array $words): void
    {
        $this->writeRaw($this->encodeSentence($words));
    }

    private function writeRaw(string $out): void
    {
        if (!$this->sock) {
            throw new RouterOSException('Not connected to the router');
        }
        $len = strlen($out);
        $sent = 0;
        while ($sent < $len) {
            $n = @fwrite($this->sock, substr($out, $sent));
            if ($n === false || $n === 0) {
                throw new RouterOSException('Write to router failed');
            }
            $sent += $n;
        }
    }

    private function readSentence(): array
    {
        $words = [];
        while (true) {
            $len = $this->readLen();
            if ($len === 0) {
                break;
            }
            if ($len > self::MAX_WORD || $this->got + $len > self::MAX_REPLY) {
                $this->close();   // stream is desynchronised / hostile: drop it
                throw new RouterOSException('Router reply too large');
            }
            $words[] = $this->readBytes($len);
        }
        return $words;
    }

    private static function encLen(int $l): string
    {
        if ($l < 0x80) {
            return chr($l);
        }
        if ($l < 0x4000) {
            return chr(($l >> 8) | 0x80) . chr($l & 0xFF);
        }
        if ($l < 0x200000) {
            return chr(($l >> 16) | 0xC0) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
        }
        if ($l < 0x10000000) {
            return chr(($l >> 24) | 0xE0) . chr(($l >> 16) & 0xFF) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
        }
        return chr(0xF0) . chr(($l >> 24) & 0xFF) . chr(($l >> 16) & 0xFF) . chr(($l >> 8) & 0xFF) . chr($l & 0xFF);
    }

    private function readLen(): int
    {
        $c = ord($this->readBytes(1));
        if (($c & 0x80) === 0) {
            return $c;
        }
        if (($c & 0xC0) === 0x80) {
            return (($c & 0x3F) << 8) | ord($this->readBytes(1));
        }
        if (($c & 0xE0) === 0xC0) {
            $b = $this->readBytes(2);
            return (($c & 0x1F) << 16) | (ord($b[0]) << 8) | ord($b[1]);
        }
        if (($c & 0xF0) === 0xE0) {
            $b = $this->readBytes(3);
            return (($c & 0x0F) << 24) | (ord($b[0]) << 16) | (ord($b[1]) << 8) | ord($b[2]);
        }
        $b = $this->readBytes(4);
        return (ord($b[0]) << 24) | (ord($b[1]) << 16) | (ord($b[2]) << 8) | ord($b[3]);
    }

    private function readBytes(int $n): string
    {
        if (!$this->sock) {
            throw new RouterOSException('Not connected to the router');
        }
        $buf = '';
        while (strlen($buf) < $n) {
            $chunk = fread($this->sock, min(65536, $n - strlen($buf)));
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($this->sock);
                $timedOut = !empty($meta['timed_out']);
                $this->close();   // a partial sentence leaves the stream unusable
                throw new RouterOSException($timedOut ? 'Router read timeout' : 'Connection closed by router');
            }
            $buf .= $chunk;
            $this->got += strlen($chunk);
            if ($this->deadline > 0 && microtime(true) > $this->deadline) {
                $this->close();
                throw new RouterOSException('Router read timeout');
            }
        }
        return $buf;
    }
}
