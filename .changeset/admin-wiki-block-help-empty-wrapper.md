---
'@10x-media/admin-wiki': patch
---

A block that no guide targets no longer renders an empty `div.wiki-block-help` after its fields. The empty wrapper kept a block's closing group from being its last field, so Payload left the group's bottom margin in place, an empty band of about 72px inside the block.
