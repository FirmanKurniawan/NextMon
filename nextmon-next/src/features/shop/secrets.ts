/** Gateway credentials and the mock secret of EVERY workspace take part in `npm run cli -- rekey`. */
import { Crypto } from '../../lib/crypto.ts';
import { Store } from '../../lib/store.ts';
import { Workspace } from '../../lib/workspace.ts';
import { GATEWAYS } from './gateways.ts';

type Doc = { gw?: Record<string, Record<string, string>>; mock_secret?: string };

Crypto.registerSecretSource({
  name: 'shop',
  list() {
    const refs: { value: string; save(v: string): void }[] = [];
    for (const w of Workspace.all()) {
      Workspace.run(w.id, () => {
        const d = Store.read<Doc>('shop', {});
        const patch = (fn: (cur: Doc, v: string) => Doc) => (v: string) => Workspace.run(w.id, () => Store.update<Doc>('shop', (cur) => fn(cur, v), {}));
        if (d.mock_secret) refs.push({ value: d.mock_secret, save: patch((cur, v) => ({ ...cur, mock_secret: v })) });
        for (const [gid, vals] of Object.entries(d.gw ?? {})) {
          for (const f of Object.hasOwn(GATEWAYS, gid) ? GATEWAYS[gid]!.fields : []) {
            const val = vals[f.key];
            if (f.secret && val) {
              refs.push({ value: val, save: patch((cur, v) => ({ ...cur, gw: { ...(cur.gw ?? {}), [gid]: { ...(cur.gw?.[gid] ?? {}), [f.key]: v } } })) });
            }
          }
        }
      });
    }
    return refs;
  },
});
