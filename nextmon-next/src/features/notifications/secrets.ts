/** The Telegram bot tokens of every workspace take part in `npm run cli -- rekey` (loaded by scripts/cli.mts). */
import { Crypto } from '../../lib/crypto.ts';
import { Store } from '../../lib/store.ts';
import { Workspace } from '../../lib/workspace.ts';

type Settings = { telegram?: { token?: string } } & Record<string, unknown>;

Crypto.registerSecretSource({
  name: 'notifications',
  list() {
    const refs: { value: string; save(v: string): void }[] = [];
    for (const w of Workspace.all()) {
      const tok = Workspace.run(w.id, () => Store.read<Settings>('settings', {}).telegram?.token ?? '');
      if (!tok) continue;
      refs.push({
        value: tok,
        save: (v) => Workspace.run(w.id, () => Store.update<Settings>('settings', (cur) => ({ ...cur, telegram: { ...(cur.telegram ?? {}), token: v } }), {})),
      });
    }
    return refs;
  },
});
