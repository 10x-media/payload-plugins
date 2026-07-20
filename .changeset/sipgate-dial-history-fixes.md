---
'@10x-media/sipgate': patch
---

Fix Neo dial to send an E.164 caller ID (never a device ID like `e4`), resolve caller ID from the selected channel name when needed, and scope OAuth call-history sync to channels the user owns so private-inbox 403s no longer empty the sync. Include call-logs when OAuth sync type is `all`. Harden related-contact resolution on call logs and Neo API request handling.
