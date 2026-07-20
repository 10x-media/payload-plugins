# @10x-media/fields

## 0.1.0-beta.0

### Minor Changes

- Initial release: a library of Payload v3 fields that look and behave native.

  - **Color field**: full picker in a constant-height row (saturation/hue/alpha, eyedropper, presets), accepts any CSS color as input, stores one configured format (`hex`/`rgb`/`hsl`/`oklch`). Presets can be static or resolved from your data per request, and linked mode stores `preset:<key>` references with a resolved virtual sibling so palette changes propagate on read. Zero-dependency color utilities exported at `./color/utils`.
  - **Icon field**: drawer browser with search, category rail, recents, and full keyboard navigation over pluggable icon libraries. Lucide, Radix, and Tabler adapters ship first-party (optional peers); `defineIconAdapter()` and `./icon/codegen` cover any other library or SVG set. Values are stable `library:name` strings; per-icon lazy loading keeps icon datasets out of every eager bundle; `createIcon()` and `createRscIcon()` render stored values on your frontend as a client component or RSC. Multi-tenant selection restriction via `resolveAvailable` with graceful degradation for disabled libraries.
  - **Encrypted fields**: AES-256-GCM at rest with authenticated binding to collection and field, for text, textarea, email, number, checkbox, date, select/radio (incl. `hasMany`), code, json, point, and richText. Keys derive from `PAYLOAD_SECRET` by default or come from explicit multi-key config with async providers; rotation runs online via `rotateEncryptedFields`. Opt-in blind indexing restores `equals`/`in` queries and `unique`. Masked admin UX with reveal toggle; masked fields never expose plaintext in list cells. Adoption and removal utilities included.
  - Optional `fields()` plugin for app-wide defaults; every factory also works standalone. Typed translations (en, de). Per-family bundle isolation verified on the built output.
