---
'@10x-media/audit-logs': minor
---

The view's filters are rebuilt. One row of pills (Event, Collection, User, Date, More filters) opens each editor in a panel below it, the way the list view opens columns and filters, and changes are applied together.

- Event folds operation and event type into one filter, with several values at once; custom types come from the new `logs.eventTypes` option and the renderer keys, and the label also shows on the row badge.
- Documents and users are picked from the list drawer, or typed as an id for something deleted, and the pills show their titles instead of ids.
- Collections and globals are labelled from their config, and Payload's own bookkeeping collections are no longer offered.
- Date presets fill the From date; documents, groups and changed fields take several values each.

Filter URLs changed: repeated `eventType`, `documentId`, `userId` and `group` keys, `slug:id` references, and no `userCollection`.
