---
'@10x-media/form-builder': minor
---

Polls and response aggregation: a submission-aggregation utility (`aggregateFieldResponses` / `aggregateFormResponses`) that tallies submissions by answer value with respondent-denominated percentages, a `complete`-by-default status filter, and a bounded scan with a `truncated` flag; a headless `<FormResults>` renderer plus a shadcn registry `form-results` component; a gated public results endpoint (`GET /api/forms/:id/results`) with a per-form `showResults` opt-in that exposes only the configured enumerable `resultsField` to anonymous callers; and a `<Poll>` component with show-results-after-vote and a per-browser localStorage already-voted guard.
