---
'@10x-media/form-builder': patch
---

The `./react` client entry no longer imports `node:crypto`. The built-in `notAlreadySubmitted` rule read the vote-change key from `votedCookie`, which signs cookies with `node:crypto`, so every host app shipped a browser crypto polyfill (and its `eval`-based `vm` shim) with the form renderer. The key and `voteChangeTargetOf` now live in a crypto-free module; `votedCookie` re-exports both, so existing imports keep working.
