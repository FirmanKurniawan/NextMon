import type { AppContext } from '../types.ts';
import FlashClean from './FlashClean';
import { readFlash } from './flash-helpers.ts';

/** Renders the (verified) flash message as a [data-flash] element that the shared app.js turns into a toast. */
export default function Flash({ ctx, value }: { ctx: AppContext; value: string | string[] | undefined }) {
  const f = readFlash(ctx.csrf, value);
  if (!value) return null;
  return (
    <>
      {f ? (
        <span hidden data-flash={f.kind}>
          {f.msg}
        </span>
      ) : null}
      <FlashClean />
    </>
  );
}
