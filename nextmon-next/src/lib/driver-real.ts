/**
 * RealDriver: the Driver contract over the RouterOS API (routeros.ts) using the shared per-router connection (RouterLink).
 * Batch helpers pipeline over the one socket; reads are retried once on a fresh connection when a REUSED socket turned out dead.
 */
import { BaseDriver, normPath } from './driver.ts';
import type { Attrs, PrintReq, Row, TryAdd, TrySet } from './driver.ts';
import { RouterOSError } from './routeros.ts';
import type { Command, RouterLink, StreamHandle, StreamHandlers } from './routeros.ts';

export class RealDriver extends BaseDriver {
  readonly demo = false;
  readonly link: RouterLink;
  constructor(link: RouterLink) {
    super();
    this.link = link;
  }

  private printCmd(path: string, query: Attrs = {}, props: string[] = []): Command {
    return { path: normPath(path) + '/print', query, props: props.length ? props : undefined };
  }

  async print(path: string, query: Attrs = {}, props: string[] = []): Promise<Row[]> {
    const cmd = this.printCmd(path, query, props);
    return (await this.link.use((c) => c.send(cmd), true)).rows;
  }

  override async printMany(reqs: Record<string, PrintReq>): Promise<Record<string, Row[]>> {
    const keys = Object.keys(reqs);
    if (keys.length === 1) {
      const q = reqs[keys[0]!]!;
      return { [keys[0]!]: await this.print(q[0], q[1], q[2]) };
    }
    const cmds = keys.map((k) => this.printCmd(reqs[k]![0], reqs[k]![1], reqs[k]![2]));
    const res = await this.link.use((c) => c.sendMany(cmds), true);
    const out: Record<string, Row[]> = {};
    for (let i = 0; i < keys.length; i++) {
      const r = res[i]!;
      if (r.error) throw r.error; // first error wins, like the sequential fallback
      out[keys[i]!] = r.reply.rows;
    }
    return out;
  }

  async add(path: string, attrs: Attrs): Promise<string> {
    const r = await this.link.use((c) => c.send({ path: normPath(path) + '/add', attrs }));
    return r.done.ret ?? '';
  }

  async set(path: string, id: string, attrs: Attrs): Promise<void> {
    await this.link.use((c) => c.send({ path: normPath(path) + '/set', attrs: { '.id': id, ...attrs } }));
  }

  async remove(path: string, id: string): Promise<void> {
    await this.link.use((c) => c.send({ path: normPath(path) + '/remove', attrs: { '.id': id } }));
  }

  async command(path: string, attrs: Attrs = {}, query?: Attrs): Promise<Row[]> {
    const p = normPath(path);
    const timeoutMs = /\/(ping|traceroute|bandwidth-test|export|backup\/save)$/.test(p) ? 60000 : undefined;
    const r = await this.link.use((c) => c.send({ path: p, attrs, query }, { timeoutMs }));
    return r.rows.length || !Object.keys(r.done).length ? r.rows : [r.done];
  }

  override async addMany(path: string, rows: Attrs[]): Promise<string[]> {
    const res = await this.addTry(path, rows);
    const bad = res.find((x) => x.err !== null);
    if (bad) throw new RouterOSError(bad.err!);
    return res.map((x) => x.id);
  }

  override async addTry(path: string, rows: Attrs[]): Promise<TryAdd[]> {
    if (!rows.length) return [];
    const p = normPath(path) + '/add';
    const res = await this.link.use((c) => c.sendMany(rows.map((attrs) => ({ path: p, attrs }))));
    return res.map((r) => (r.error ? { id: '', err: r.error.message } : { id: r.reply.done.ret ?? '', err: null }));
  }

  override async setTry(path: string, changes: [string, Attrs][]): Promise<TrySet[]> {
    if (!changes.length) return [];
    const p = normPath(path) + '/set';
    const res = await this.link.use((c) => c.sendMany(changes.map(([id, attrs]) => ({ path: p, attrs: { '.id': id, ...attrs } }))));
    return res.map((r) => ({ err: r.error ? r.error.message : null }));
  }

  override async setMany(path: string, changes: [string, Attrs][]): Promise<void> {
    const bad = (await this.setTry(path, changes)).find((x) => x.err !== null);
    if (bad) throw new RouterOSError(bad.err!);
  }

  override async removeMany(path: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const p = normPath(path) + '/remove';
    const res = await this.link.use((c) => c.sendMany(ids.map((id) => ({ path: p, attrs: { '.id': id } }))));
    const bad = res.find((r) => r.error);
    if (bad?.error) throw bad.error;
  }

  override async commandMany(path: string, list: Attrs[]): Promise<void> {
    if (!list.length) return;
    const p = normPath(path);
    const res = await this.link.use((c) => c.sendMany(list.map((attrs) => ({ path: p, attrs }))));
    const bad = res.find((r) => r.error);
    if (bad?.error) throw bad.error;
  }

  stream(path: string, attrs: Attrs, h: StreamHandlers): StreamHandle {
    const p = normPath(path);
    // monitor-traffic & co are bare commands; print-style streams (/log/print follow) pass their own verb
    const cmd: Command = { path: p, attrs };
    let inner: StreamHandle | null = null;
    let cancelled = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    let ended = false;
    const end = (e?: Error) => {
      if (ended) return;
      ended = true;
      h.onEnd?.(e);
      resolveDone();
    };
    this.link.ready().then(
      (c) => {
        if (cancelled) return end();
        inner = c.stream(cmd, { onRow: h.onRow, onEnd: end });
      },
      (e: Error) => end(e),
    );
    return {
      done,
      cancel: async () => {
        cancelled = true;
        if (inner) await inner.cancel();
        else end();
      },
    };
  }

  override close(): void {
    // the connection is shared (pooled) between callers: the pool closes idle links itself
  }
}
