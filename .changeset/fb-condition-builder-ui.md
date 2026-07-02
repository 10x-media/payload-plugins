---
'@10x-media/form-builder': patch
---

Polish the condition builder admin UI: replace bare `<button>` elements with Payload's `Button` component (`buttonStyle="secondary"` for add actions, `buttonStyle="error"` for remove), replace the text "Remove" label with a compact `×` symbol, remove inline styles in favour of CSS class selectors, and rename the OR/AND labels to `form-builder-condition__or-badge` / `form-builder-condition__and-badge` to make them styleable as distinct visual affordances.
