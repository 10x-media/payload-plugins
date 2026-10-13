---
'@10x-media/audit-logs': patch
---

**Fixed: the plugin boots on Postgres and SQLite with several auth collections.** The `user, createdAt` index named a column a polymorphic `user` does not have there, and the adapter refused the schema. The pair is now left out when `user` is polymorphic; the field keeps its own index.
