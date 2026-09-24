---
'@10x-media/conversations': minor
---

Initial beta of `@10x-media/conversations`: conversations bound to any document, global or custom key, with comments as the first extension.

- **Instances**: one `conversations()` call per use case, each with its own `<slug>-messages` and `<slug>-reads` collections and endpoints under `/api/conversations/<slug>`.
- **Access**: required batch conversation access (`perTarget` for simple cases), per-channel `read` / `create` / `update` / `delete`, collections closed over REST.
- **Messages**: channels, one-level threads with atomic reply counts, soft delete with placeholders, idempotent sends, plain-text projection, custom message types with typed `data`.
- **Mentions**: a Lexical feature with a typeahead that offers only users who can read the channel; `afterMention` fires once per new mention.
- **Read state**: cursors per user, conversation and channel, and per thread; unread counts and a "New messages" divider.
- **Polling**: only mounted conversations, one tab per key across the browser via Web Locks and BroadcastChannel, signed subscription tokens, nothing while hidden; a transport interface for realtime adapters.
- **UI**: headless hooks for websites (`/react`), admin primitives on `@payloadcms/ui` (`/client`), and client or server components for message types and slots.
- **`comments()`**: a Comments button in the document controls of the listed collections and globals, opening a drawer with channel tabs, feed, composer and stacked threads.
