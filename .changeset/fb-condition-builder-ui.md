---
'@10x-media/form-builder': patch
---

Polish the condition builder admin UI: bare `<button>` elements are replaced with Payload's `Button` component, the OR/AND separators render as themed labels (`fb-condition-builder__or-label` / `fb-condition-builder__and-label`), and the row layout ships as class-based styles in the bundled `@10x-media/form-builder/styles.css` (using Payload CSS variables for light/dark theming). Import that stylesheet in your admin layout to pick up the builder styling.
