---
'@10x-media/sipgate': minor
---

Fix prune queries (id → sipgateId), device endpoint user leak, XML injection, CSRF state nonce, OAuth token field access, refresh token rotation, transfer/hangupCall error propagation, enableContactMatchUi inversion, publishConfig.exports missing SipgateSyncButton, engines.node range, and hardcoded relationTo in OAuth callback. Remove unreachable classic REST code. Add integration and unit tests for all fixed bugs.
