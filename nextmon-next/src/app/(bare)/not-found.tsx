import { NeutralNotFound } from '../../features/shop/ui.tsx';
import { reqInfo, translatorFor } from '../../features/shop/public-next.ts';

/** Neutral 404 of the public pages (wrong slug / order id / token): no branding, no workspace data. */
export default async function BareNotFound() {
  const info = await reqInfo();
  return <NeutralNotFound t={translatorFor(info)} nonce={info.nonce} />;
}
