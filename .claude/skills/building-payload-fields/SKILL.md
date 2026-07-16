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
- Combine `readOnly || disabled` at the leaf control, like native fields do.
- Input rows are EXACTLY 40px, matching Payload's `base(2)` form input height. Pickers, drawers, and popovers carry the extra UI; the field row itself never grows.
- CSS uses only Payload custom properties: `--theme-elevation-*`, `--theme-error-*`, `--style-radius-*`, `--base`, `--theme-input-bg`. Dark mode comes free via elevation inversion; hardcoded colors break it.
- No `!important`. No z-index values beyond Payload's own scale. No emojis in UI; icons are inline SVG or Payload-provided icons.

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

## Verification step (before declaring a field done)

1. `pnpm dev fields`, open the field's showcase collection.
2. Compare against the native text field rendered next to it: row height (40px), border color and width, radius, focus ring, error state, readOnly rendering, placeholder color, dark mode.
3. Exercise every admin prop from the passthrough checklist at least once via the showcase configs.
4. `pnpm lint fields && pnpm typecheck fields && pnpm test fields`, plus `pnpm build fields && pnpm --filter @10x-media/fields test:dist`, plus `pnpm check:processes`.
