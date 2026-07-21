---
'@10x-media/wildix': minor
---

Initial beta of `@10x-media/wildix`: a Wildix Unified Communications integration for Payload v3, sibling to `@10x-media/sipgate`.

- **Sync**: colleagues, devices, and call queues from the Wildix PBX API into `wildix-users`, `wildix-devices`, and `wildix-channels` collections, plus call history from the WMS CallHistory API into `call-logs`. Supports a shared API-key mode and per-user OAuth2.
- **Live call control**: click-to-dial, answer, hold/unhold, blind and attendant transfer, DTMF, and hangup via the WMS Call Control API. A live call floating window and call activity chart mirror the sipgate UI.
- **Webhooks**: HMAC-SHA256 signature verification on Wildix's JSON call events (`call:start`/`live:progress`/`update`/`completed`), driving the active-call store and call log writes.
- **Contact matching**: resolves inbound/outbound numbers against your own contact collections, same phone-normalization approach as sipgate.
- **No IVR**: Wildix has no equivalent to sipgate's XML-based IVR responder; call flows are configured natively in the Wildix Dialplan or Voice Agents instead.
