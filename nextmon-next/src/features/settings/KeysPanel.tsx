'use client';
/** API keys tab: create form (the plain key is shown once, with a copy button) + list with revoke. Port of the PHP "API keys" panel. */
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import ActionForm from './ActionForm';
import { createKeyAction, revokeKeyAction } from './actions.ts';

type Key = { id: string; name: string; prefix: string; scope: string; last: string };
type Labels = Record<'intro' | 'newKey' | 'copy' | 'name' | 'scope' | 'create' | 'none' | 'key' | 'lastUsed' | 'revoke' | 'revokeConfirm' | 'nameCol' | 'actions', string>;

export default function KeysPanel({ csrf, keys, labels: L }: { csrf: string; keys: Key[]; labels: Labels }) {
  const [fresh, setFresh] = useState('');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <>
      {fresh ? (
        <div className="alert warn" style={{ marginBottom: 'var(--s4)' }}>
          <Icon name="key" size={18} />
          <div style={{ minWidth: 0 }}>
            <b>{L.newKey}</b>
            <br />
            <code style={{ wordBreak: 'break-all' }} id="new-key">
              {fresh}
            </code>
          </div>
          <button className="btn btn-sm" type="button" data-copy="#new-key">
            {L.copy}
          </button>
        </div>
      ) : null}
      <p className="muted" style={{ marginBottom: 'var(--s3)' }}>
        {L.intro} <code suppressHydrationWarning>{origin}/api/v1/</code>
      </p>
      <pre className="out" style={{ marginBottom: 'var(--s4)' }}>{`GET  /api/v1/status | users | profiles | active | hosts | sales | logs | health | interfaces
POST /api/v1/vouchers  {"profile":"1Jam","qty":5,"prefix":"","length":6,"mode":"vc","batch":"api"}   (write scope)
POST /api/v1/kick      {"user":"abc123"}                                                              (write scope)
?router=ID selects a router (default: first)`}</pre>
      <ActionForm action={createKeyAction} reset className="row" style={{ marginBottom: 'var(--s4)', alignItems: 'flex-end' }} onResult={(r) => r.key && setFresh(r.key)}>
        <input type="hidden" name="_csrf" value={csrf} />
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="k-name">{L.name}</label>
          <input className="input" id="k-name" name="name" required maxLength={40} placeholder="billing-system" />
        </div>
        <div className="field">
          <label htmlFor="k-scope">{L.scope}</label>
          <select className="select" id="k-scope" name="scope">
            <option value="read">read</option>
            <option value="write">write</option>
          </select>
        </div>
        <button className="btn btn-primary">
          <Icon name="key" size={16} />
          {L.create}
        </button>
      </ActionForm>
      {keys.length === 0 ? (
        <p className="muted">{L.none}</p>
      ) : (
        <div className="table-wrap">
          <table className="tbl resp">
            <thead>
              <tr>
                <th>{L.nameCol}</th>
                <th>{L.key}</th>
                <th>{L.scope}</th>
                <th>{L.lastUsed}</th>
                <th>
                  <span className="sr-only">{L.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td data-label={L.nameCol}>
                    <b>{k.name}</b>
                  </td>
                  <td data-label={L.key} className="mono">
                    {k.prefix}...
                  </td>
                  <td data-label={L.scope}>
                    <span className={'badge badge-' + (k.scope === 'write' ? 'warn' : 'neutral')}>{k.scope}</span>
                  </td>
                  <td data-label={L.lastUsed}>{k.last || <span className="muted">-</span>}</td>
                  <td className="actions" data-label="">
                    <ActionForm action={revokeKeyAction} className="inline-form" confirm={L.revokeConfirm}>
                      <input type="hidden" name="_csrf" value={csrf} />
                      <input type="hidden" name="id" value={k.id} />
                      <button className="btn btn-sm btn-danger">{L.revoke}</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
