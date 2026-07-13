---
'@10x-media/form-builder': minor
---

Bundled captcha adapters and widget components. `turnstileProvider`, `recaptchaProvider` (v2 + v3 with `minScore`), and `hcaptchaProvider` verify tokens server-side with fail-closed semantics (network errors, timeouts, and non-2xx responses reject the submission). Matching headless `TurnstileCaptcha`, `RecaptchaCaptcha`, and `HcaptchaCaptcha` components on the `/react` export load each vendor script once, report tokens through `onToken` for `<Form captchaToken>`, clear on expiry or error, and expose `reset` (plus on-demand `execute` refresh for reCAPTCHA v3) via a ref handle.
