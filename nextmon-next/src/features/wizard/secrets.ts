/** The wizard keeps a freshly generated router API password (encrypted) until the admin adopts it: include it in key rotation. */
import { Crypto } from '../../lib/crypto.ts';
import { Store } from '../../lib/store.ts';
import { Workspace } from '../../lib/workspace.ts';

type State = { cred?: Record<string, { pass: string }> };

Crypto.registerSecretSource({
  name: 'wizard-cred',
  list() {
    const refs: { value: string; save(v: string): void }[] = [];
    for (const w of Workspace.all()) {
      const st = Workspace.run(w.id, () => Store.read<State>('wizard', {}));
      for (const [user, c] of Object.entries(st.cred ?? {})) {
        if (!c.pass) continue;
        refs.push({
          value: c.pass,
          save: (v) =>
            Workspace.run(w.id, () => Store.update<State>('wizard', (cur) => ({ ...cur, cred: { ...(cur.cred ?? {}), [user]: { ...(cur.cred?.[user] as object), pass: v } as { pass: string } } }), {})),
        });
      }
    }
    return refs;
  },
});
