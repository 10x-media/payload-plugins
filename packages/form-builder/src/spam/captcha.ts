import type { CaptchaProvider } from './types'

/**
 * Identity helper for authoring a captcha provider (mirrors `defineAction`/`definePollOptionSource`).
 * Bundled adapters (`turnstileProvider`, `recaptchaProvider`, `hcaptchaProvider`) are built with it;
 * use it directly for any other verification service. The submit path verifies a token carried on
 * the submission.
 */
export const defineCaptchaProvider = (provider: CaptchaProvider): CaptchaProvider => provider
