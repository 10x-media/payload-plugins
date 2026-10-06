---
'@10x-media/form-builder': minor
---

Essential action dispatch, opened up for hosts running real providers behind it.

- New `dispatch: { deadlineMs }` plugin option bounds the inline action passes (essential and no-runner fallback); the 5s default is exported as `INLINE_DISPATCH_DEADLINE_MS` so an action can size its own HTTP timeouts under the bound it runs under.
- A deadline breach is no longer reported as a definite failure: the visitor gets a 504 with an "outcome unknown" message (a definite refusal keeps the 502), and the kept row is stamped `actionUncertain` instead of `actionFailed`. Behavioral change to note: timed-out essential passes previously stamped `actionFailed`; operator filters keyed on that flag should treat `actionUncertain` as "still in flight".
- Breached essential work is watched to settlement instead of dropped: a late success clears the stamp, runs the skipped rest actions and prune, and emits `submission.created`; a late failure upgrades the stamp to `actionFailed`.
- `validateConfig` on `ActionDefinition`: a save-time, cross-field check over one stored action instance, with the message attached to the action block (`actions.<index>`) rather than to a single config field.
- `ActionResult.detail` plus an exported `ActionError(message, detail)` let an action report structured failure context (status code, provider response) without concatenating it into the message; the plugin logs it as a structured field.
