/** What a settings/security/notifications server action returns to <ActionForm/>. `key` = a one-time secret to show (new API key). */
export type ActionResult = { ok: boolean; msg: string; key?: string };
