---
'@10x-media/conversations': minor
---

Links straight into a conversation, for notifications and emails.

- `ChatDrawer`, `ChatPanel` and `ChatTrigger` take `channel` (open on it instead of the first) and `message` (open at it: its channel, the feed loaded around it however old, scrolled to and marked; a reply opens its thread at the reply). `useChatPanel` takes `initialChannel` and `message`.
- When the user can no longer read what a link names, the first readable channel opens under a notice instead of silently showing another one. `useChatPanel` reports it as `requestedChannelUnavailable` / `requestedMessageUnavailable`; `renderUnavailable` replaces the built-in notice.
- `ChatTrigger` takes `title`, `subtitle` and `fallback` (shown instead of nothing when the user can read no channel). Outside an edit view, pass `subtitle`: the default is the edited document's title.
- `ChatDrawer` starts over when `conversationKey`, `channel` or `message` changes while it is mounted, so one drawer can serve every link; an open thread of the previous conversation no longer stays open.
- New `GET /api/conversations/<slug>/messages/:id`: one message, with its thread's root for a reply, after access; a 404 otherwise. `useConversation` and `useThread` take `anchor` (a time to open around), and `useFeed` takes `focus` (a message id to open at) and returns `highlighted`.
