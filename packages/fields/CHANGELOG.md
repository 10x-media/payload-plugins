# @10x-media/fields

## 0.1.0-beta.4

### Patch Changes

- `colorField` no longer overflows its input border when squeezed by `admin.width` in a row. The chip, text entry, and format badge now live in a clipping region that fades out at the right edge when (and only when) the run actually overflows, and the clear control keeps its place inside the border at every width. The fade is a CSS mask rather than a background-colored overlay, so it renders correctly over the error, read-only, and hover backgrounds in both themes.

## 0.1.0-beta.3

### Minor Changes

- Linked color references carry opacity: `preset:<key>/<alpha>` stores a preset reference at 0-100 percent, and the picker's alpha slider rewrites the suffix instead of flattening the reference to a concrete color. Resolution applies the alpha in the field's configured format on both scheme members, the chip and list cell surface the percentage, `alpha: false` strips suffixes on commit, and the new `parsePresetReference` export (`/color` and `/color/utils`) parses stored references for presentation code.

## 0.1.0-beta.2

### Patch Changes

- Fix generated icon manifests whose data disagreed with their own type annotation.

  `generateIconManifest` emitted `label` in the manifest data but the emitted annotation
  still described the pre-label shape, so a manifest that used the field produced one TS2353
  per labelled icon in a strict consumer. The nodes module had the same latent mismatch one
  field over: its annotation only allowed flat tuples while glyph nodes may nest children.

  Both annotations now mirror the full contract, and the emitters are covered by tests that
  typecheck their own output with the compiler rather than inspecting strings. Regenerate
  your manifests to pick up the corrected annotations; the data is unchanged.

## 0.1.0-beta.1

### Minor Changes

- `colorField` presets can carry a light/dark pair, so one linked reference stays mode-responsive wherever it renders.

  - `ColorSchemeValue` widens a preset's `value` to `string | { light, dark }`. Flat and scheme presets mix freely in one palette; a pair with one member filled in behaves as that color in both schemes.
  - `linked.resolve` chooses the virtual sibling's shape: `'value'` (default) keeps it a text field, `'schemes'` makes it a JSON field carrying the pair. `linked.fallback` accepts a pair too. A field configured before this release is unaffected, and flattens to `light` if its resolver starts returning pairs.
  - `presetsFromArray()` builds presets from a repeatable array field, one row per color, with flat or paired value columns.
  - `lightDark()` and `isColorSchemeValue()` ship from `./color` and `./color/utils` for rendering and narrowing a resolved value.
  - Scheme presets render as a diagonal split swatch in the picker, the chip, and the list cell. A non-linked field stores a scheme preset's `light` member, since a text column holds one color.
  - Fixed: a list cell showed no swatch and falsely reported a missing preset whenever the resolved sibling was not a plain string.

- Icon field: library-supplied labels, fallback parity, and layered libraries.

  **Fixes**

  - `createIcon` rendered nothing when an adapter resolved an icon to `null`, while
    `createRscIcon` returned the caller's `fallback`. The documented contract is the latter,
    so both factories now honour it.
  - An icon's display label could only be derived from its name, so a library keyed by code
    showed `HUN` as `Hun` and a screen reader announced that for every cell.

  **Added**

  - `IconMeta.label` (optional, accepts a per-locale record) replaces the derived label.
    Where a library supplies one, the accessible name carries the label alone and the tooltip
    shows the raw name beside it, so an editor can still discover the stored value.
  - `IconAdapter.resolveMeta` / `resolveMetaMany`: one exact lookup serving validation and
    labels, never cached, so a runtime-backed library stays correct where a cached manifest
    cannot. Lookups issued in a tick coalesce into a single batched call.
  - `IconAdapter.layers`: ordered sources under one slug, later winning by name, each
    declaring its own render strategy and cache policy.
  - Render strategies `nodes` (with a declarable canvas), `svg` (sanitised and sprited
    client-side), `url`, and `component`. `IconNode` accepts nested children.
  - `uploadIconLayer`, backing a library with a Payload upload collection so editors can add
    icons without a deploy. Defaults to the `url` strategy, which is inert; inlining uploaded
    SVG is opt-in.
  - A plugin-registered manifest endpoint at `/10x-fields/icon-manifest/:slug`, mounted only
    when a server layer exists, auth-gated and availability-filtered.
  - `IconRendererAdapter.layers` for frontend override resolution.
  - Radix now renders from bulk node-data in the drawer instead of a dynamic import per icon.

  **Possible breaking change for third-party manifests**

  `generateIconManifest` no longer requires kebab-case names, which unblocks libraries keyed
  by code. It does now reject two names differing only by case, because drawer search
  normalises case and an editor cannot tell them apart. A hand-written manifest holding such
  a pair will fail generation until one is renamed. The bundled libraries are unaffected.

  Everything else is additive. An adapter that sets none of the new fields behaves exactly as
  before, verified by characterization hashes over every glyph in all three bundled libraries.

## 0.1.0-beta.0

### Minor Changes

- Initial release: a library of Payload v3 fields that look and behave native.

  - **Color field**: full picker in a constant-height row (saturation/hue/alpha, eyedropper, presets), accepts any CSS color as input, stores one configured format (`hex`/`rgb`/`hsl`/`oklch`). Presets can be static or resolved from your data per request, and linked mode stores `preset:<key>` references with a resolved virtual sibling so palette changes propagate on read. Zero-dependency color utilities exported at `./color/utils`.
  - **Icon field**: drawer browser with search, category rail, recents, and full keyboard navigation over pluggable icon libraries. Lucide, Radix, and Tabler adapters ship first-party (optional peers); `defineIconAdapter()` and `./icon/codegen` cover any other library or SVG set. Values are stable `library:name` strings; per-icon lazy loading keeps icon datasets out of every eager bundle; `createIcon()` and `createRscIcon()` render stored values on your frontend as a client component or RSC. Multi-tenant selection restriction via `resolveAvailable` with graceful degradation for disabled libraries.
  - **Encrypted fields**: AES-256-GCM at rest with authenticated binding to collection and field, for text, textarea, email, number, checkbox, date, select/radio (incl. `hasMany`), code, json, point, and richText. Keys derive from `PAYLOAD_SECRET` by default or come from explicit multi-key config with async providers; rotation runs online via `rotateEncryptedFields`. Opt-in blind indexing restores `equals`/`in` queries and `unique`. Masked admin UX with reveal toggle; masked fields never expose plaintext in list cells. Adoption and removal utilities included.
  - Optional `fields()` plugin for app-wide defaults; every factory also works standalone. Typed translations (en, de). Per-family bundle isolation verified on the built output.
