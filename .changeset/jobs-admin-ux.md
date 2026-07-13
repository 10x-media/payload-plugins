---
"@10x-media/jobs": minor
---

Dashboard UX: clickable queue-health badges that filter the list, a linked Job title column (workflow or task), readable relative timestamps for started, lease-expires, and scheduled dates (no clear button on runner-owned fields), scheduled jobs show their run time, workflow and task selects populated from config with an exclusive workflow-or-task create form, a native-looking queue select over the text field (programmatic queue names stay unrestricted), localized relative time, and a collection-level overrides.jobs seam (CollectionOverride and FieldsOverride types are exported).

Fix: worker stop and drainWorker now await the in-flight run tick before returning, so no job write can land after teardown (this was the source of CI-only test flakes, including transaction aborts and MongoNotConnectedError during shutdown).
