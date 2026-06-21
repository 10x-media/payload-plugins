import type { CaptchaProvider } from './types'

/**
 * Identity helper for authoring a captcha provider (mirrors `defineAction`/`defineConsentSource`).
 * v1 ships no built-in provider; a project supplies one (Turnstile/reCAPTCHA/hCaptcha) and the submit
 * path verifies a token carried on the submission. Prebuilt providers are a v1.x addition.
 */
export const defineCaptchaProvider = (provider: CaptchaProvider): CaptchaProvider => provider
