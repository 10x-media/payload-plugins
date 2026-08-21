---
"@10x-media/fields": minor
---

An encrypted field's identification `hint` may now expose up to 32 characters, up from 8. Every credential format in use carries a constant prefix (`sk_live_`, `whsec_`, `ghp_`, `xoxb-`), and a budget of 8 was spent on that prefix before reaching anything that identifies a particular key.

The cap was doing a job it cannot do, so the real guard is now the value being sliced rather than the config asking for the slice: a hint is stored only when the plaintext keeps at least as many characters hidden as the hint exposes, and at least 8 either way. One field can therefore serve a collection holding both long tokens and short ones, hinting the first and declining the second instead of exposing half of it. No configuration valid before this release changes behaviour, since 8 exposed already required 8 hidden.

The bullet run stays exactly `maskDots` wide, with the hint's ends added around it, so a hinted value shows the same run as every other concealed span and the count remains a pure presentation choice. A hint too wide for a narrow field clamps with an ellipsis, in the input and in the list cell, with the lock badge held at its size.

`admin.width` and `admin.style` now reach encrypted fields. A custom Field component short-circuits the path where Payload applies them, so an encrypted field in a row ignored its width while a native sibling honoured it, and the two rendered at different widths.
