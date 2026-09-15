---
'@10x-media/form-variants': patch
---

Register component items nested in a step's containers.

A `{ type: 'component' }` item inside a step `row`, `collapsible` or `group` was rendered but never added to `admin.dependencies`, so the import map generator did not know about it and the component could not resolve at render time. Only items at the top level of a step were registered. The walk now descends into the containers, as the renderer already did.
