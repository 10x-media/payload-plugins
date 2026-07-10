---
'@10x-media/sipgate': minor
---

Fix prune queries (id → sipgateId), device endpoint user leak, XML injection, CSRF state nonce, OAuth token field access, refresh token rotation, transfer/hangupCall error propagation, enableContactMatchUi inversion, publishConfig.exports missing SipgateSyncButton, engines.node range, and hardcoded relationTo in OAuth callback. Remove unreachable classic REST code. Add integration and unit tests for all fixed bugs.

Add webhookUrl plugin option (required for OAuth2/IVR) to decouple public webhook/OAuth redirect URLs from config.serverURL, which is optional and may not be set. Export SipgateCredentials and SipgateAuthType from the public types entry. Add automatic needsReconnect detection: when a refresh token expires, the sipgate-users doc is flagged and a warning banner appears on the SipgateOAuthButton prompting the user to reconnect.
