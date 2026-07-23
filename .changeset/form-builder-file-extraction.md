---
"@10x-media/form-builder": patch
---

Split the two largest source files for maintainability, with no behavior change.

- The `FormBuilderPluginOptions` type (nearly 200 lines of the plugin's public option surface, with its doc comments) moves out of `index.ts` into a dedicated `src/options.ts`, leaving `index.ts` focused on the plugin factory and the public barrel. The type is still exported under the same name (and its `PluginOptions` alias).
- The forms collection's built-in endpoints (poll results/options/close, plus the optional consent-sources, from-addresses, and departments endpoints) move out of `buildFormsCollection` into `buildFormsEndpoints`, so the collection builder stays focused on field and hook composition.

`index.ts` drops from ~558 to ~346 lines and `forms.ts` from ~845 to ~743; the moved code is unchanged and every existing unit, integration, and cross-DB test passes against it.
