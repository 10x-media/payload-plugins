---
'@10x-media/form-builder': minor
---

Add `className` prop to `<Form>`: additional CSS classes are merged onto the root `<form>` element (and the post-submit success node) via the new `cn` utility, which is also exported from the `/react` subpath for use in custom renderers and field components.
