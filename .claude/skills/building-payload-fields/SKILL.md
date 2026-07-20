---
name: building-payload-fields
description: Use when building or changing a custom admin field in @10x-media/fields or any plugin in this repo. Covers field anatomy, the Payload token and 40px height rules, admin-prop passthrough, the function-only overrides rule, typed i18n, bundle isolation, and the showcase and verification requirements.
---

# Building Payload fields

A custom field is done when an admin cannot tell it apart from a native Payload field. Same height, same borders, same prop contracts, same dark mode. Everything below is the checklist that gets there.

## Field anatomy (every field ships all of these)

1. **Factory** (`src/fields/<name>/field.ts`): returns a real Payload field config, text-backed unless the design says otherwise. `admin.components.Field` is a STRING importMap path (`@10x-media/fields/client#XxxField`) with `clientProps` carrying only serializable options. Never import a component into a field config; that breaks importMap generation and server bundles.
2. **Client Field component** (`src/fields/<name>/XxxField.tsx`) built from `@payloadcms/ui` primitives, with its CSS co-located and imported by the component.
3. **List Cell** (`XxxCell.tsx`). Server-renderable cells go through the rsc barrel (`@10x-media/fields/rsc#XxxCell`); interactive cells through client.
4. **Shared validation**: server `validate` and the client UI consume the same parser module. They can never disagree, because they are the same code.
5. **Typed i18n**: every UI string goes through `keys` from `src/translations/keys.ts`, shipped in en and de.
6. **Tests**: unit for pure logic co-located as `src/**/*.test.ts`; int specs in `tests/int/*.int.spec.ts` booting through `@10x-media/payload-test-harness`; e2e for UI-critical flows in `tests/e2e/`.
7. **Docs**: page(s) under `apps/docs/content/docs/fields/`.
8. **Showcase collection**: every field adds or extends a dev-app collection demonstrating EVERY configuration (formats, required, readOnly, width, localized, async variants), rendered adjacent to native Payload fields for direct comparison.

## Payload token + 40px height rules

- Wrapper structure mirrors native fields exactly: outer `div` with `fieldBaseClass`, the field-type class, and state classes (`error`, `read-only`), inner `field-type__wrap`. Copy the structure from a native field in `@payloadcms/ui`, not from memory.
- Render Label, Error, and Description through `RenderCustomComponent` so server-provided component overrides (`admin.components.Label` etc.) win over the defaults.
- Apply `mergeFieldStyles` for `admin.width` and `admin.style`.
- Combine `readOnly || disabled` at the leaf control, like native fields do, and see the `admin.readOnly` gotcha below.
- Input rows are EXACTLY 40px, matching Payload's `base(2)` form input height. Pickers, drawers, and popovers carry the extra UI; the field row itself never grows.
- **Size in literal px, not `var(--base)` arithmetic.** Payload compiles its scss `base()` calls to literal px, but the `--base` custom property is rem-derived and shrinks with the responsive root font size. A row built from `calc(var(--base) * 2)` measures 40px at desktop and ~37px below 1024px, next to a native input that stays 40px. Use the same literal values the `formInput` mixin compiles to.
- CSS uses only Payload custom properties: `--theme-elevation-*`, `--theme-error-*`, `--style-radius-*`, `--theme-input-bg`. Dark mode comes free via elevation inversion; hardcoded colors break it.
- No `!important`. No z-index values beyond Payload's own scale. No emojis in UI; icons are inline SVG or Payload-provided icons (`XIcon` and friends are exported from `@payloadcms/ui`).

## Composite inputs (fields with more than one control)

When a field needs a trigger, a text entry, a badge, and a clear button, they belong INSIDE one input-shaped container, not side by side as separate controls. Adjacent controls read as several fields; one container reads as one native input.

- The container replicates the `formInput` mixin (border `--theme-elevation-150`, radius `--style-radius-s`, `--theme-input-bg`, shadow, 40px, the 100ms triple transition), hover goes to elevation-250, and focus rides `:focus-within` to elevation-400. Error and readOnly states style the container, not the children.
- Inner controls are chrome-less: the text input is borderless with `background: transparent; color: inherit; min-width: 0` so it flexes inside a row.
- Clear affordances copy the native select's clear indicator (`ClearIndicator` in `packages/ui/src/elements/ReactSelect`): bare icon, no button chrome, `--accessibility-outline` on focus-visible.
- Read the real thing before styling: `packages/ui/src/scss/vars.scss` (`formInput`, `readOnly`, `lightInputError`, `darkInputError`).

## Gotchas verified against the Payload source

- **`admin.readOnly` does not reach custom Field components.** `renderField.tsx` derives `clientProps.readOnly` from doc-level locks and permissions only; native fields pick up `admin.readOnly` later, in `RenderFields`, on a path that a custom `Field` component short-circuits. A custom field MUST read it itself: `readOnly || disabled || field.admin?.readOnly`. Symptom if you miss it: a field configured `admin: { readOnly: true }` stays fully editable.
- **`Popup` portals its content to `document.body`.** A className you pass to `Popup` lands on the trigger root, so no ancestor selector from it can reach the panel. Target portalled content by a class on your own panel (`.popup__scroll-container:has(> .my-panel)`). Payload also caps that scroll container at `calc(var(--base) * 10)` = 200px, which silently clips any taller panel behind a hidden scrollbar.
- **Field rhythm is not yours to set.** Vertical spacing comes from `.render-fields > .field-type { margin-bottom: var(--spacing-field) }`. Inside a `row`, children get `--spacing-field: 0` and spacing comes from `row-gap`, which goes inert when the row flips to `display: block` at `max-width: 1024px`: native row children touch there too. Never add a hand-tuned margin to "fix" spacing; verify against a native field at the same breakpoint first.
- **Verify styling by measurement, not by eye.** `getComputedStyle` on your control and on a native input, at several viewport widths, is the only proof that they match.

## Input UX semantics

- Normalize at commit boundaries (blur, debounced commit), never mid-keystroke: rewriting the input while it is focused throws the caret and fights the user.
- Be forgiving on blur: salvage the first valid token out of dirty input (double pastes, wrapping CSS syntax) rather than erroring. Extract candidates and validate them; never blind-strip characters, which can fabricate a value the user never typed.
- `isClearable: false` means the value cannot be REMOVED, not merely that the X is hidden. Emptying the input and committing must revert to the last valid value. A never-set field may stay empty; `required` enforces the rest.
- Anything derived from an external source (presets, options) renders as a chip with its resolved label, never as a raw reference string.

## Admin-prop passthrough checklist

A field is not done until each of these behaves exactly like it does on a native text field:

- `admin.description`, `admin.placeholder`, `admin.className`
- `admin.readOnly`, `admin.condition`, `admin.width`, `admin.style`
- `admin.components.Label` / `Error` / `Description` / `beforeInput` / `afterInput`
- `required`, `localized`, RTL rendering
- `isClearable` semantics wherever a clear affordance exists (hidden when `required`)

## Overrides: function + spread only (HARD RULE)

Every factory exposes exactly this escape hatch, typed to the factory's concrete field type:

```ts
overrides?: (args: { field: TextField }) => TextField
```

Consumers return a new object built with spreads. deepMerge, in any form or from any library, is BANNED for field overrides: merged configs hide which keys were replaced, resurrect deleted keys, and silently combine incompatible admin components. Do not add a deepMerge dependency; do not hand-roll one. If an override needs to touch a nested key, the consumer spreads that level explicitly.

## Typed i18n requirement

- Keys live in `src/translations/keys.ts` as a `keys` const with the `fields:` namespace; locales are `Record<TranslationKey, string>` maps (en + de), so a missing string is a type error.
- Client components use the plugin's `useTranslation` wrapper (typed keys, no `@ts-expect-error`).
- Server-side labels use `labelForKey` / `asTranslate` from `src/translations/server.ts`.
- Never inline a user-visible string. Add a key.

## Bundle rules

- Component references in field configs are importMap string paths only.
- Heavy assets (icon manifests, search indexes, picker internals) load lazily behind user interaction. Nothing heavy in an eager admin or frontend bundle.
- Subpath isolation is a tested invariant: color, icon, and encrypted code never import across families. Shared code lives in `src/plugin/`, `src/utils/`, `src/translations/`, and `src/types.ts`. Enforced by `tests/dist/isolation.spec.ts`; run `pnpm build fields` then `pnpm --filter @10x-media/fields test:dist` after touching imports.
- Server-only code (`node:crypto`) never enters the `./client` graph.
- New subpaths keep package.json `exports`, `publishConfig.exports`, and `tsdown.config.ts` entries in lockstep, then get added to the isolation spec's entry lists.

## Rendering many items (pickers, grids over hundreds/thousands)

A per-item lazy-imported component is right for a production frontend (a page shows a few, so the bundle stays tiny) and wrong for an admin picker that shows hundreds at once: scrolling mounts a dynamic import per cell and the list janks. For the admin surface, render from bulk data loaded ONCE per source (e.g. an icon library's node-data JSON, lazy-imported when the picker opens), as inline SVG or plain markup, so scrolling touches no imports. Keep the per-item-lazy path for the field's own frontend renderer. This split (bulk-in-admin, lazy-on-frontend) is what keeps scroll smooth AND consumer bundles small; the dist lazy-graph test must still prove the bulk data is dynamic-import-only. Measured payoff on the icon drawer: median 6ms/frame and one network request for a full scroll, versus thousands of per-icon imports.

Guarantee grid alignment structurally: fixed square cells (fixed px, `flex: 0 0 <size>`, `justify-content: flex-start`) whose height equals the virtualizer's `estimateSize`, so full and partial rows tile at identical column positions. In-flow labels of variable height break this; put the label on hover (Payload `Tooltip`) instead. Align a header/search/banner to the visible grid edge by deriving its width from the cell geometry (`columns * cellSize - 2 * cellInset`), not the raw container width, since the outlined button is inset within its cell box.

Payload `Drawer`, like `Popup`, portals its content and its Gutter is `overflow:auto` with its own title header: size the drawer body to fill the remaining height via a `min-height:0` flex chain, or you get a second scrollbar.

## Verification step (before declaring a field done)

Verify by measurement and by driving it, not by screenshot alone. Code review passes clean and the field still ships a runtime bug (a React duplicate-key warning that renders icons wrong, a search bar overhanging the grid by 4px); the live console and `getComputedStyle` catch what reading the diff cannot.

1. `pnpm dev fields`, open the field's showcase collection.
2. Compare against the native text field rendered next to it BY MEASUREMENT (`getComputedStyle` on your control and a native input at several viewport widths): row height (40px), `margin-bottom` (must equal native; a custom field is a `.field-type` and inherits `.render-fields > .field-type` margin, so any stray margin on your root is a bug), border color and width, radius, focus ring, error/readOnly rendering, placeholder color, dark mode.
3. Read the browser console for errors (React key warnings, hydration) while exercising the field. Zero tolerance.
4. Exercise every admin prop from the passthrough checklist at least once via the showcase configs.
5. `pnpm lint fields && pnpm typecheck fields && pnpm test fields`, plus `pnpm build fields && pnpm --filter @10x-media/fields test:dist`, plus `pnpm check:processes`.
6. Dev-app gotcha: `touch`ing a config does NOT trigger a Turbopack HMR recompile (content-hashed) - edit the file's content to force a real reload. And `startMemoryMongo()` must cache its replica set on `globalThis` or every reload leaks a mongod.
