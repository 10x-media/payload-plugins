---
'@10x-media/form-builder': minor
---

Changeable votes for polls via a new `poll.allowChange` checkbox (default off; existing polls are unaffected). With it on, the voted cookie carries the voter's signed submission id, a repeat submit from the same browser updates that submission in place instead of creating another, and the vote tally moves with the changed answer (old value decrements, new one increments, respondents unchanged). Changes run the full create pipeline (validation, spam controls, consent recapture) and are rejected once the poll closes. New `resolveVotedSubmission` (root and `/rsc`) resolves the voter's current pick server-side from the httpOnly cookie; `<Poll currentVote>` highlights it in results ("Your vote" badge, also via `<FormResults currentValues>`) and offers a "Change vote" button that reopens the form prefilled. `onSuccess` now also receives the submitted answer values on its result object.
