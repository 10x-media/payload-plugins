---
'@10x-media/form-builder': minor
---

Add `renderResults` to `<Poll>`: a render prop that replaces the built-in `<FormResults>` wherever the poll shows results (after voting, when closed, and for a recorded outcome). It receives the exact `FormResultsProps` the default rendering gets, so hosts can draw result rows from their own data, keyed by each bucket's option value, or wrap `<FormResults>` in their own layout. Omitting the prop changes nothing.
