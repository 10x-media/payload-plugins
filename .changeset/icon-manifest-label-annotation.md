---
'@10x-media/fields': patch
---

Fix generated icon manifests whose data disagreed with their own type annotation.

`generateIconManifest` emitted `label` in the manifest data but the emitted annotation
still described the pre-label shape, so a manifest that used the field produced one TS2353
per labelled icon in a strict consumer. The nodes module had the same latent mismatch one
field over: its annotation only allowed flat tuples while glyph nodes may nest children.

Both annotations now mirror the full contract, and the emitters are covered by tests that
typecheck their own output with the compiler rather than inspecting strings. Regenerate
your manifests to pick up the corrected annotations; the data is unchanged.
