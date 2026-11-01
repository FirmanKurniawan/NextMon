'use client';
/**
 * Public order form (markup/classes of views/shop.php). Submits through the `placeOrder` server action and then does a HARD
 * navigation to the order page: that page's scripts (polling, QR, countdown) are plain <script> tags that need a full page load.
 * The live total and double-submit guard come from the shared mod-shop.js (same element ids as the PHP view).
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import type { Old } from './public.ts';
import type { PlaceResult } from './public-actions.ts';

export type Pack = { id: string; label: string; badge: string; desc: string; price: string };
export type FormLabels = {
  package: string;
  name: string;
  phone: string;
  optional: string;
  email: string;
  terms: string;
  agree: string;
  total: string;
  pay: string;
};

export default function OrderForm({
  action,
  csrf,
  slug,
  refCode,
  packs,
  labels,
  requirePhone,
  terms,
  initial,
}: {
  action: (fd: FormData) => Promise<PlaceResult>;
  csrf: string;
  slug: string;
  refCode?: string;
  packs: Pack[];
  labels: FormLabels;
  requirePhone: boolean;
  terms: string;
  initial?: Old;
}) {
  const [err, setErr] = useState('');
  const [old, setOld] = useState<Old | undefined>(initial);
  const busy = useRef(false);
  const sel = old?.package || (packs.length === 1 ? packs[0]!.id : '');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const form = e.currentTarget;
    setErr('');
    try {
      const r = await action(new FormData(form));
      if (r.to) {
        window.location.assign(r.to);
        return;
      }
      setErr(r.error ?? 'Error');
      if (r.old) setOld(r.old);
    } catch {
      setErr('Error');
    }
    busy.current = false;
    const b = form.querySelector<HTMLButtonElement>('#shp-submit');
    if (b) {
      b.disabled = false;
      b.classList.remove('loading');
    }
  }

  return (
    <>
      {err ? (
        <div className="alert err" role="alert">
          <Icon name="alert" size={18} />
          <div>{err}</div>
        </div>
      ) : null}
      <form method="post" className="shp-form" id="shop-form" autoComplete="on" onSubmit={onSubmit}>
        <input type="hidden" name="_csrf" value={csrf} />
        <input type="hidden" name="w" value={slug} />
        {refCode ? <input type="hidden" name="ref" value={refCode} /> : null}
        <div className="shp-hp" aria-hidden="true">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <fieldset className="shp-packs">
          <legend className="label">{labels.package}</legend>
          {packs.map((p) => (
            <label className="shp-pack" key={p.id}>
              <input type="radio" name="package" value={p.id} data-price={p.price} required defaultChecked={sel === p.id} />
              <span className="shp-pack-body">
                <span className="shp-dot" aria-hidden="true" />
                <span className="shp-pack-main">
                  <span className="shp-pack-title">
                    <b>{p.label}</b>
                    {p.badge !== '' ? <span className="shp-chip">{p.badge}</span> : null}
                  </span>
                  {p.desc !== '' ? <span className="shp-pack-desc">{p.desc}</span> : null}
                </span>
                <span className="shp-price">{p.price}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="shp-fields">
          <div className="field">
            <label htmlFor="f-name">{labels.name}</label>
            <input className="input" id="f-name" name="name" defaultValue={old?.name ?? ''} required maxLength={60} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="f-phone">
              {labels.phone}
              {requirePhone ? null : <span className="muted"> ({labels.optional})</span>}
            </label>
            <input className="input" id="f-phone" name="phone" type="tel" inputMode="tel" defaultValue={old?.phone ?? ''} required={requirePhone} maxLength={20} autoComplete="tel" placeholder="08xxxxxxxxxx" />
          </div>
          <div className="field">
            <label htmlFor="f-email">
              {labels.email} <span className="muted">({labels.optional})</span>
            </label>
            <input className="input" id="f-email" name="email" type="email" defaultValue={old?.email ?? ''} maxLength={100} autoComplete="email" />
          </div>
        </div>

        {terms.trim() !== '' ? (
          <>
            <details className="shp-terms">
              <summary>{labels.terms}</summary>
              <div style={{ whiteSpace: 'pre-line' }}>{terms}</div>
            </details>
            <label className="check shp-agree">
              <input type="checkbox" name="terms" value="1" required />
              {labels.agree}
            </label>
          </>
        ) : null}

        <div className="shp-bar">
          <div className="shp-total">
            <span className="muted">{labels.total}</span>
            <b id="shp-total">-</b>
          </div>
          <button className="btn btn-primary btn-lg" type="submit" id="shp-submit">
            {labels.pay}
          </button>
        </div>
      </form>
    </>
  );
}
