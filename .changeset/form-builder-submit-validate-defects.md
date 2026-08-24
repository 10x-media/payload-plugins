---
'@10x-media/form-builder': minor
---

Two submit/validate fixes. Actions can declare `essential: true` on `defineAction`: an essential action runs inline before the response (never queued, bounded by the dispatch deadline), its failure or timeout turns the submit into an error the visitor sees with a translated plugin message, the remaining actions are skipped, and the submission is kept even on a `persistSubmissions: false` form so a failed provider handoff never loses what the visitor sent. Fire-and-forget actions are unchanged. And blurring a pristine field no longer reveals its required error: reveal now needs the field to be dirty (changed since mount or the last reset) or its step submitted, which also stops a freshly reset form from showing errors when clicked.
