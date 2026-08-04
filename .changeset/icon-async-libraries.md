---
'@10x-media/fields': minor
---

Icon field: library-supplied labels, fallback parity, and layered libraries.

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
