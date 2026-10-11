---
'@10x-media/audit-logs': patch
---

Auth events and deletes no longer record `locale`: a login has no document, and a delete removes every locale, so the request's locale said nothing about either. The view hides it on such entries written before.
