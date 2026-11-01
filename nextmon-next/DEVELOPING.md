# DEVELOPING — panduan fitur NextMON (Next.js)

Pondasi sudah menyediakan: multi-tenant (workspace), auth, sesi, CSRF, driver RouterOS (Real/Demo/ReadOnly/Cached), shell UI, SSE trafik, i18n, audit. **Fitur baru cukup menambah folder `src/features/<nama>/` — tidak ada file bersama yang diedit.**

## 1. Aturan emas

1. Semua akses data tenant terjadi di dalam `ctx.run(() => ...)` (sudah otomatis untuk halaman/API fitur). Di luar konteks, `Store` melempar `NoWorkspaceError` (fail-closed).
2. **Jangan pernah** membaca id workspace dari request. Workspace datang dari sesi server (`ctx.workspace`).
3. Semua panggilan RouterOS lewat `ctx.driver()` (atau `Routers.driver(id)`); jangan buka socket sendiri.
4. Kapabilitas: `view` < `sell` < `write` < `admin` < `platform`. Selalu deklarasikan `cap` pada halaman/API. Router yang dibagikan `ro` otomatis memakai `ReadOnlyDriver` (semua tulis ditolak).
5. Import di `src/lib` memakai path relatif berekstensi `.ts` (agar `scripts/cli.mts` dan vitest jalan tanpa bundler). Di `src/app`, `src/components`, `src/features` boleh `@/...`.
6. Tidak ada inline script/handler (CSP nonce). Perilaku klien = file di `public/assets/js/*` (aset bersama dari edisi PHP) atau komponen klien kecil.
7. `fs` / `node:sqlite` hanya boleh di file yang di-allow-list ESLint (`db.ts`, `crypto.ts`, `workspace.ts`, `env.ts`). Data fitur → `Store`.
8. Teks UI: sumber bahasa Inggris, terjemahan `id` lewat `feature.i18n`. Komentar kode Inggris singkat.
9. Mode demo wajib berfungsi: halaman harus jalan dengan `DemoDriver` tanpa router.

## 2. Struktur fitur

```
src/features/<nama>/
  feature.ts   # defineFeature({ id, nav, pages, api, i18n })   (wajib, export default)
  page.tsx     # server component halaman
  api.ts       # (opsional) handler JSON
  secrets.ts   # (opsional) mendaftarkan Crypto.registerSecretSource agar ikut `npm run cli -- rekey`
```

`scripts/gen-features.mjs` memindai `src/features/*/feature.ts` dan menulis `src/features/_generated.ts` (di-ignore git; dijalankan otomatis oleh dev/build/lint/typecheck/test). Konflik (id, path halaman, nama API, key nav) terdeteksi oleh `Features.conflicts()` dan diuji.

### Kontrak `defineFeature`

| Kunci | Fungsi |
| --- | --- |
| `id` | unik, sama dengan nama folder |
| `nav[]` | `{ key, href, icon, label, group, cap?, order?, tab? }` → sidebar, drawer, palet perintah, tab bawah (max 4, `tab` kecil = kiri) |
| `pages[]` | `{ path, title, cap?, page?, scripts?, component }`; path boleh `/x/:id` |
| `api{}` | `/api/json/<nama>[/…]` dan `/json/<nama>` (untuk JS bersama). Guard otomatis: sesi, CSRF untuk non-GET, kapabilitas, konteks workspace |
| `i18n` | `{ id?: {...}, en?: {...} }` digabung ke kamus inti |

Halaman publik (tanpa login, mis. toko voucher / callback bayar) dibuat di route group `src/app/(bare)/...` dan path-nya ditambahkan ke `PUBLIC_*` di `src/middleware.ts` (satu-satunya file bersama yang perlu disentuh untuk halaman publik). Halaman publik **harus** menentukan workspace dari slug di URL via `Workspace.bySlug()` lalu `Workspace.run(id, ...)`.

## 3. Contoh lengkap: halaman "Hosts"

Sudah ada di `src/features/hosts/` dan dipakai sebagai acuan.

**feature.ts**

```ts
import { defineFeature } from '../types.ts';

export default defineFeature({
  id: 'hosts',
  nav: [{ key: 'hosts', href: '/hotspot/hosts', icon: 'monitor', label: 'Hosts', group: 'Hotspot', order: 50 }],
  pages: [{ path: '/hotspot/hosts', title: 'Hosts', cap: 'view', component: () => import('./page.tsx') }],
  api: {
    hosts: {
      cap: 'view',
      async GET(ctx) {
        const data = await ctx.driver().print('/ip/hotspot/host');
        return { ok: true, total: data.length, data };
      },
    },
  },
  i18n: { id: { 'Hotspot hosts': 'Host hotspot', 'No hosts.': 'Tidak ada host.' } },
});
```

**page.tsx** — server component, otomatis berjalan di dalam `ctx.run()`:

```tsx
import type { PageProps } from '../types.ts';

export default async function HostsPage({ ctx }: PageProps) {
  const t = ctx.t;
  const hosts = await ctx.driver().print('/ip/hotspot/host');
  return (
    <section className="card glass">
      <h1 className="page-title">{t('Hotspot hosts')}</h1>
      <table className="tbl resp">…{hosts.map((h) => <tr key={h['.id']}>…</tr>)}</table>
    </section>
  );
}
```

React sudah meng-escape output. HTML buatan pengguna (template voucher/login) **wajib** lewat `sanitizeTemplateHtml()` dari `src/lib/sanitize.ts` sebelum `dangerouslySetInnerHTML`.

## 4. Aksi tulis (form)

Pakai Server Action + `runAction` (cek sesi, CSRF dari field `_csrf`, kapabilitas, workspace):

```ts
'use server';
import { runAction } from '../../server/guard.ts';
export async function saveThing(fd: FormData) {
  return runAction({ cap: 'write' }, fd, async (ctx) => {
    await ctx.driver().add('/ip/hotspot/user', { name: String(fd.get('name')) });
    audit(ctx, 'user.add', String(fd.get('name')));
  });
}
```

Form menyertakan `<input type="hidden" name="_csrf" value={ctx.csrf} />`. Untuk API JSON: `runApi({ cap }, req, rest, handler)` (sudah dipakai registry). Catat tindakan penting dengan `audit(ctx, aksi, detail)`.

Komponen anak async yang dirender di dalam halaman tidak mewarisi AsyncLocalStorage secara pasti: bungkus pekerjaan data dengan `ctx.run(() => ...)` di dalam komponen itu.

## 5. Library yang bisa dipakai

| Modul | Isi |
| --- | --- |
| `lib/driver.ts` | `print/add/set/remove/command`, `printMany`, `addMany/setMany/removeMany` (pipeline), `stream` |
| `lib/routers.ts` | `Routers.list/get/current/save/remove/driver/test` (termasuk router yang dibagikan) |
| `lib/store.ts` | `Store.read/write/update` per workspace (SQLite), `Store.log` untuk log; koleksi global hanya yang ada di allow-list |
| `lib/scripts.ts`, `voucher.ts`, `sales.ts` | generator script on-login, voucher, parser penjualan (kompatibel Mikhmon) |
| `lib/crypto.ts` | `Crypto.encrypt/decrypt` AES-256-GCM, `registerSecretSource` |
| `lib/net.ts` | `clientIp`, `hit` (rate limit), `checkOutboundUrl` (anti-SSRF untuk webhook) |
| `lib/traffic-hub.ts` | `TrafficHub.subscribe(routerId, iface, cb)` — satu stream upstream per router+interface |
| `lib/audit.ts`, `i18n.ts`, `cache.ts`, `fmt.ts` | log audit, terjemahan, cache ber-namespace, format angka/tanggal |

## 6. Perintah

```
npm run dev          # gen registry + sync aset + next dev
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (termasuk larangan import fs/sqlite di luar allow-list)
npm test             # vitest (unit + isolasi tenant + RouterOS vs server palsu)
npm run build        # next build + postbuild (standalone siap: node .next/standalone/server.js)
npm run sync-assets  # salin CSS/JS/ikon dari ../nextmon-php/public (jangan restyle)
npm run cli -- rekey # rotasi kunci enkripsi (hentikan server dulu)
npm run cli -- doctor
```

Test baru: letakkan di `tests/unit/*.test.ts`; `tests/setup.ts` memberi direktori data sementara per file. Untuk RouterOS gunakan `tests/fixtures/fake-routeros.ts`; untuk tenant gunakan `tests/helpers.ts` (`bootstrapPlatform`, `makeTenant`, `addStaff`).

## 7. Checklist PR fitur

- [ ] `cap` benar pada semua halaman/API/aksi
- [ ] Tidak ada id workspace dari klien; semua data lewat `ctx.run`
- [ ] Teks UI lewat `t()`, terjemahan `id` ada
- [ ] Jalan di mode demo
- [ ] Test (termasuk isolasi tenant bila menyimpan data baru)
- [ ] `CHANGELOG.md` dan `MEMORY.md` (via agen utama)
