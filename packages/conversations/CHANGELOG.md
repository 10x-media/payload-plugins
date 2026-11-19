# @10x-media/conversations

## 4.0.0-alpha.4

### Patch Changes

- Requires Payload `4.0.0-beta.10`: the `payload` and `@payloadcms/*` peers are `^4.0.0-beta.10`, and the plugins are built and tested against it.

## 4.0.0-alpha.3

### Minor Changes

- A new `./shared` entry exports the helpers with no server and no React dependency (key formats and parsers, constants, error names and guards, formatters), for a host module that both server code and client components import. On Payload 4 the browser build of `payload` is `payload/shared`, so a client bundle that reaches the root fails on `definePlugin` and the Local API, and a server caller of a `'use client'` entry gets a client reference instead of the function. The root and the client entries keep exporting the same helpers.

## 4.0.0-alpha.2

### Minor Changes

- Links straight into a conversation, for notifications and emails.

  - `ChatDrawer`, `ChatPanel` and `ChatTrigger` take `channel` (open on it instead of the first) and `message` (open at it: its channel, the feed loaded around it however old, scrolled to and marked; a reply opens its thread at the reply). `useChatPanel` takes `initialChannel` and `message`.
  - When the user can no longer read what a link names, the first readable channel opens under a notice instead of silently showing another one. `useChatPanel` reports it as `requestedChannelUnavailable` / `requestedMessageUnavailable`; `renderUnavailable` replaces the built-in notice.
  - `ChatTrigger` takes `title`, `subtitle` and `fallback` (shown instead of nothing when the user can read no channel). Outside an edit view, pass `subtitle`: the default is the edited document's title.
  - `ChatDrawer` starts over when `conversationKey`, `channel` or `message` changes while it is mounted, so one drawer can serve every link; an open thread of the previous conversation no longer stays open.
  - New `GET /api/conversations/<slug>/messages/:id`: one message, with its thread's root for a reply, after access; a 404 otherwise. `useConversation` and `useThread` take `anchor` (a time to open around), and `useFeed` takes `focus` (a message id to open at) and returns `highlighted`.

## 4.0.0-alpha.1

### Major Changes

- Payload 4 support, on Next.js and TanStack Start. The plugin's Local API calls pass `overrideAccess` or run as the requesting user, as Payload 4's Local API applies access by default. Its own collections (messages, reads, reactions, the attachments extension's uploads) turn off Payload 4's default versions and core authorship, so their schema is unchanged; the attachments collection states its signed-in `create` and `read` access, which was Payload 3's default. Globals get the comments button through `admin.components.edit.beforeDocumentControls`. The mention node declares its JSON schema, so generated types include `SerializedConversationsMentionNode`, and drops its legacy HTML converter. The admin UI takes Payload 4's look from Payload's own components on its tokens: Payload's drawer header, Payload's tabs for the channel tabs (`conversations-tabs__tab` now sits on the tab button), a secondary `Button` for the trigger, a ghost `Button` for the message menu, and a composer drawn like Payload's inputs and rich text editor, with its icons. `Composer` takes an `icons` prop (`ComposerIcons`, `defaultComposerIcons`) that replaces its icons by role; the link tooltip gains `linkIcon` and `linkActions` parts. See Upgrading to Payload 4 in the docs.

## 0.1.0-beta.1

### Minor Changes

- `serverComponents: 'server-function'` renders server slot and message type components through the plugin's own server function (`conversationsServerFunctions` from `/rsc`, spread into `handleServerFunctions` in `app/(payload)/layout.tsx`) instead of the internal dashboard widget, which is then not registered. The default stays `'widget'`, which needs no wiring. The widget is no longer registered for the plugin's own slot components (reactions, attachments), which are client components, only for components you configure. Added to a dashboard by hand, it now says it is not for display and can be removed.

### Patch Changes

- The admin UI ships in the same locales as the other plugins, not English only.

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/conversations`: conversations bound to any document, global or custom key, with comments, reactions and attachments as the first extensions.

  - **Instances**: one `conversations()` call per use case, each with its own `<slug>-messages` and `<slug>-reads` collections and endpoints under `/api/conversations/<slug>`.
  - **Access**: required batch conversation access answering per target with grants (every channel, some channels, or read only; `perTarget` for simple cases), channel rules per user run once per request, per-message `update` / `delete`, collections closed over REST; only users of the instance's `users` collections take part, and malformed ids answer 404 or 400.
  - **Messages**: channels, one-level threads with atomic reply counts, soft delete with placeholders, idempotent sends, plain-text projection, size limits for bodies and custom `data`, custom message types with typed `data` drawn in the message frame or as the whole row (`layout: 'bare'`), system authors for server code (`systemAuthors`), server helpers `postMessage` and `touchMessage`.
  - **Mentions**: a typeahead that offers only users who can read the channel, scoped per users collection; `afterMention` fires once per new mention.
  - **Read state**: cursors per user, conversation and channel, and per thread; unread counts in one query and a "New messages" divider.
  - **Transports**: polling by default (one tab per key via Web Locks and BroadcastChannel, signed tokens, nothing while hidden), Server-Sent Events served by Payload with `databaseBus`, `payloadKVBus`, `redisBus` or `memoryBus`, and a dependency-free Pusher-compatible transport; one realtime connection per browser. Your own transport plugs into the admin too, its client half named by import path (`client: { factory }`).
  - **Extensions**: `before` / `after` config phases plus per-message `decorate`, a `send` hook that stores the extension's part of a new message, endpoints, stored `messageFields`, slots, composer addons (`useComposerAddon`: data and files for the send), client data and cleanup per message and per target. `comments()` adds a Comments button and drawer to collections and globals; `reactions()` adds emoji reactions with per-person limits, stored in their own collection or on the message; `attachments()` adds files on messages, uploaded on send into its own upload collection or yours, under that collection's access, with a picker, drop and paste in the composer and an image and PDF viewer.
  - **Admin UI**: drawer, panel, feed, message, thread and trigger on Payload's own components, a Lexical composer with toolbar, `/` commands, markdown and links, config-level slots (client or server components, `composerBelow` and `composerActions` inside the composer), and `components` to replace any built-in (trigger, drawer, panel, tabs, feed, message, composer, thread).
  - **Website UI**: headless hooks (`/react`, `/reactions/react`, `/attachments/react`), the composer core without `@payloadcms/ui` (`/composer`) with named, skinnable parts, and shadcn registry sources.
