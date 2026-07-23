---
"@10x-media/form-builder": patch
---

DX and robustness cleanup from the package audit.

- **Renderers honor the passed `id` prop.** Eleven built-in field renderers minted their own `useId()` and ignored the `id` the render host already generates and passes, so each field ran two id hooks and the documented contract prop was dead. They now use the passed `id` (the host stays the single source; a custom host can control it). `repeater` and `message` already conformed.
- **The overlay backdrop no longer fires `onClose` twice.** A backdrop click was handled both by the backdrop's own `onClick` and by the surface's outside-pointerdown dismiss, so it closed twice; the backdrop's handler also ignored `closeOnOutsideClick: false`. The backdrop is now purely presentational and dismissal is owned solely by the dismiss hook, which respects the flag.
- **Polls surface a results-load failure.** A failed results fetch was stored as an empty array and rendered as a zero-count "no votes yet" table. It now shows a localized error instead of masking the failure.
- **`captureFileRef` gains unit coverage** for its ownership match/mismatch, unidentified-submitter fail-open, unstamped-upload passthrough, and failed-load cases.
- **The consent proof documents its time-of-check/time-of-use window** (wording is read at form load but re-resolved at submit) so the intended behavior is not mistaken for a bug.
