---
'@10x-media/audit-logs': minor
---

**Breaking: `user` and `impersonator` are stored as text, `{ relationTo, value }`, whatever the number of auth collections.** They were relationships, and on Postgres and SQLite a relationship's foreign key cleared them from every entry once the user was deleted (`set null` on a column, `cascade` on a `_rels` row). The entry now keeps the user it names after the user is gone, adding a second auth collection no longer changes the schema, and the plugin boots on Postgres with several auth collections, which a `user, createdAt` index on a polymorphic relationship used to prevent. Query `user.value` and `user.relationTo` instead of `user`; `depth` no longer populates either field, so fetch the user yourself when you need more than the id. Existing entries need a one-off data edit on MongoDB and a migration on Postgres, both on the new [upgrading](https://docs.10xmedia.de/audit-logs/upgrading) page.
