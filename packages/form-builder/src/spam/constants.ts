/** Default honeypot decoy field name. Plausible to bots, unlikely to collide with a real field name. */
export const DEFAULT_HONEYPOT_FIELD = 'confirm_email'

/** Reserved `values` entry carrying a captcha token from the client. */
export const CAPTCHA_TOKEN_KEY = '__fb_captcha'

/** `req.context` key under which the spam guard stashes the resolved identity for upload-ownership verification. */
export const IDENTITY_CONTEXT_KEY = 'formBuilderSpamIdentity'
