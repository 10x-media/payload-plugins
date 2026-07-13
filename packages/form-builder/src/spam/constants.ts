/**
 * Default honeypot decoy field name. "website" is plausible to bots but doesn't trigger Chrome's
 * email-address autofill (unlike names containing "email"). Bots fill every input; real users
 * never see the hidden field.
 */
export const DEFAULT_HONEYPOT_FIELD = 'website'

/** Reserved `values` entry carrying a captcha token from the client. */
export const CAPTCHA_TOKEN_KEY = '__fb_captcha'

/** `req.context` key under which the spam guard stashes the resolved identity for upload-ownership verification. */
export const IDENTITY_CONTEXT_KEY = 'formBuilderSpamIdentity'
