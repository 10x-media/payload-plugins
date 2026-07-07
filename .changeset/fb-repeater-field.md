---
'@10x-media/form-builder': minor
---

Add `repeater` field type: a field that captures a dynamic list of rows, each containing a set of sub-fields defined once in the admin UI. Includes row-count validation (`minRows`/`maxRows`), a client-side renderer with add/remove row controls, per-row sub-field validation on the server, and a numbered row view in the submission answers panel.

Fix `minRows` zero-row bypass: a repeater submitted with no rows was silently accepted even when `minRows > 0`, because the empty-array coercion was immediately skipped by the field loop's empty guard. The guard now lets repeaters fall through to `validate()` so row-count constraints are enforced correctly.

Fix sub-field error display: server-side sub-field validation errors (reported with path `fieldName[rowIndex].subFieldName`) are now surfaced inline next to the offending input in the repeater renderer. Client-side sub-field validation also runs on submit so errors appear before the request is sent.

Replace `deepMerge`-based collection overrides with an explicit spread API. The `overrides` plugin option now accepts `CollectionOverrides` objects for `forms`, `formSubmissions`, and `uploads`. Fields are overridden via a `FieldsOverride` function (`({ defaultFields }) => Field[]`) that receives the plugin's defaults and returns the final array, making additions and removals intentional. Hooks are appended after the plugin's own hooks, guaranteeing that the spam guard and submission validator always run first. Spread order per key is documented and encodes who wins without relying on a merge library.
