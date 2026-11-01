/** Every plain-form endpoint of the hotspot feature family, keyed by the path after /hs/ (see src/app/hs/[...path]/route.ts). */
import { activeForms } from '../active/forms.ts';
import { bindingForms } from '../bindings/forms.ts';
import { hostForms } from '../hosts/forms.ts';
import { importForms } from '../import/forms.ts';
import { profileForms } from '../profiles/forms.ts';
import { templateForms } from '../templates/forms.ts';
import { userForms } from '../users/forms.ts';
import { voucherForms } from '../vouchers/forms.ts';
import { walledForms } from '../walledgarden/forms.ts';
import type { FormRoute } from './forms.ts';

export const FORMS: Record<string, FormRoute> = {
  ...userForms,
  ...profileForms,
  ...activeForms,
  ...hostForms,
  ...bindingForms,
  ...walledForms,
  ...voucherForms,
  ...templateForms,
  ...importForms,
};
