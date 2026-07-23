/**
 * Default honeypot decoy field name. "website" is plausible to bots but doesn't trigger Chrome's
 * email-address autofill (unlike names containing "email"). Bots fill every input; real users
 * never see the hidden field.
 */
export const DEFAULT_HONEYPOT_FIELD = 'website'

/** Reserved `values` entry carrying a captcha token from the client. */
export const CAPTCHA_TOKEN_KEY = '__fb_captcha'

/**
 * Reserved `values` entry the honeypot decoy is submitted under. The decoy's DOM input keeps a
 * plausible cosmetic name (e.g. `website`), but the submitted value rides this fixed key so a real
 * field sharing that name is never stripped or mistaken for the decoy.
 */
export const HONEYPOT_VALUE_KEY = '__fb_hp'

/** `req.context` key under which the spam guard stashes the resolved identity for upload-ownership verification. */
export const IDENTITY_CONTEXT_KEY = 'formBuilderSpamIdentity'
