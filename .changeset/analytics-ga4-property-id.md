---
"@10x-media/analytics": minor
---

**Behavioral (GA4): Property ID takes the number alone.** `properties/<id>` saved, and every read answered "3 INVALID_ARGUMENT: ... A numeric Property ID is required." The field now refuses it. A stored document with such a value saves again once it is corrected.
