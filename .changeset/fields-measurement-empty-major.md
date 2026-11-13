---
'@10x-media/fields': patch
---

Measurement: an empty major part next to a typed minor part of a compound unit now reads as zero, so inches typed into an empty `ft in` field (or pounds into an empty `st lb` field) commit on blur. `5` in the inches input saves as `0 ft 5 in` instead of being dropped while the form turned dirty. Clearing the feet of a stored value while its inches are still shown likewise keeps those inches. Clearing both parts still clears the value.
