---
'@10x-media/form-builder': patch
---

Move `@standard-schema/spec` from devDependencies to dependencies. Its types are part of the public validation API surface, and as a devDependency its declaration file was inlined under `dist/node_modules` instead of resolving from the consumer's install.
