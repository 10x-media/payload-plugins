---
'@10x-media/form-builder': minor
---

Adds the `@10x-media/form-builder/react` headless renderer foundation (Phase 4a).

- **Renderer contract**: `defineFieldRenderer` + `FieldRendererProps<TValue>` -- the typed interface every field renderer implements. `RendererTranslate` for localized built-in copy.
- **Renderer registry**: `resolveRenderers` merges a base renderer map with a consumer override config using the same `false/true/object` convention as the field-type and validation-rule registries.
- **Unstyled accessible primitives**: `Input`, `Textarea`, `Select`, `Checkbox`, and `FieldShell` -- bare HTML controls with full ARIA wiring (`aria-invalid`, `aria-describedby`) and no visual opinions, ready to style or compose.
- **Six built-in field renderers**: `defaultRenderers` covers `text`, `textarea`, `email`, `number`, `select`, and `checkbox`. Each renderer uses `FieldShell` plus the matching primitive.
- **Optional container-query layout grid**: `FormLayout` + `widthProps` + an opt-in stylesheet (`@10x-media/form-builder/styles.css`). Import the stylesheet for a responsive container-query grid; omit it for your own layout.
