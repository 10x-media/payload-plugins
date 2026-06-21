---
'@10x-media/form-builder': minor
---

Add spam basics: honeypot + rate-limiting on the public submission and upload paths (on by default), a captcha adapter seam (`defineCaptchaProvider`), server-identity upload-ownership scoping, and privacy-first capture metadata. All controls are opt-out (`spam: false` or per-control `false`). App-level rate limiting is defense-in-depth that complements edge/CDN/WAF limiting; the default limiter is a soft window counter over `payload.kv`.
