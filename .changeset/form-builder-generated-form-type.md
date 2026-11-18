---
'@10x-media/form-builder': patch
---

`toFormDocument` accepts a generated form type whose blocks set an `interfaceName`, with no cast. Its `fields` parameter had an index signature, which no generated block interface satisfies.
