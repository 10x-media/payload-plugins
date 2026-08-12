---
'@10x-media/form-builder': patch
---

Fix every REST submission returning 500 on beta.15. The vote-change endpoint delegates ordinary creates to Payload's stock create handler, which re-parses the request body the endpoint had already consumed; a consumed fetch body stays non-null, so the second read threw "Body is unusable". The endpoint now hides the spent stream before delegating (the parsed `data`/`file` are already on the request), and finds the stock handler by its own endpoint tag instead of handler identity, so a host-wrapped handler can no longer recurse. Local API submissions were never affected.
