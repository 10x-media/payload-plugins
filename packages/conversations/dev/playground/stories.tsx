'use client'

import {
	Avatar,
	ChatChannelTabs,
	ChatComposer,
	ChatDrawer,
	ChatFeed,
	ChatMessage,
	type ChatMessageProps,
	ChatThread,
	ChatTrigger,
	type FeedItem,
	listsFeature,
} from '@10x-media/conversations/client'
import {
	type ChannelView,
	resolveLabel,
	type UseConversationResult,
	useChannels,
	useConversation,
	type WindowMessage,
} from '@10x-media/conversations/react'
import { Button, PopupList, useModal } from '@payloadcms/ui'
import { type ReactNode, useState } from 'react'
import {
	ANNA,
	AUTHORS,
	CUSTOMER,
	GONE,
	lexical,
	MARC,
	ME,
	MOCK_KEYS,
	mockServer,
	NOTE_TYPE,
} from './mockServer'
import { extraFormatsFeature, textColorFeature } from './textColor'

export type LiveTarget = { key: string; label: string }

export type StoryContext = { live: LiveTarget[] }

export type Story = {
	/** Mock stories run under the mock provider; live ones under the admin's real one. */
	backend: 'live' | 'mock'
	description: ReactNode
	group: string
	id: string
	render: (context: StoryContext) => ReactNode
	title: string
}

const INSTANCE = 'comments'

/** Client renderer for the mock's `playground.note` type, the `renderType` prop in use. */
export const renderNote = (message: WindowMessage): ReactNode => {
	if (message.type !== NOTE_TYPE) return null
	const data = (message.data ?? {}) as { from?: string; to?: string }
	return (
		<div className="pg-note">
			Status changed from <strong>{data.from}</strong> to <strong>{data.to}</strong>
		</div>
	)
}

const Case = ({ children, label, note }: { children: ReactNode; label: string; note?: string }) => (
	<div className="pg-case">
		<div className="pg-case__label">
			{label}
			{note ? <span className="pg-case__note"> · {note}</span> : null}
		</div>
		{children}
	</div>
)

/** A box the size of the drawer (width from the toolbar), laid out like the drawer body. */
const Frame = ({ children, height }: { children: ReactNode; height?: number }) => (
	<div className="pg-frame conversations-drawer" style={height ? { height } : undefined}>
		{children}
	</div>
)

const Inspect = ({ title, value }: { title: string; value: unknown }) => (
	<details className="pg-inspect">
		<summary>{title}</summary>
		<pre>{JSON.stringify(value, null, 2)}</pre>
	</details>
)

/**
 * The drawer's parts composed by hand, outside a drawer: what a project would
 * write for a sidebar chat or a support page. Thread opens beside the feed.
 */
const InlineConversation = ({
	conversationKey,
	inspect = true,
}: {
	conversationKey: string
	inspect?: boolean
}) => {
	const channelsResult = useChannels(conversationKey)
	const { channels, reads, viewer } = channelsResult
	const [active, setActive] = useState<null | string>(null)
	const [thread, setThread] = useState<null | WindowMessage>(null)
	const current = channels.find((channel) => channel.slug === active) ?? channels[0]
	const conversation = useConversation({ channel: current?.slug, key: conversationKey })
	const label = current ? resolveLabel(current.label) : ''
	const other = channels.length === 2 ? channels.find((channel) => channel !== current) : undefined
	return (
		<div className="pg-stack">
			<div className="pg-split">
				<Frame>
					<ChatChannelTabs
						active={current?.slug ?? ''}
						channels={channels}
						onChange={(slug) => {
							setActive(slug)
							setThread(null)
						}}
						reads={reads}
					/>
					{current ? (
						<>
							<ChatFeed
								conversation={conversation}
								empty={`No messages in ${label} yet.`}
								instance={INSTANCE}
								key={`feed:${current.slug}`}
								onOpenThread={setThread}
								renderType={renderNote}
							/>
							<ChatComposer
								channel={current.slug}
								conversationKey={conversationKey}
								cue={current.cue ?? null}
								cueAction={
									other
										? {
												label: `Switch to ${resolveLabel(other.label)}`,
												onClick: () => setActive(other.slug),
											}
										: null
								}
								disabledReason={current.canCreate ? undefined : 'This channel is read-only.'}
								instance={INSTANCE}
								key={`composer:${current.slug}`}
							/>
						</>
					) : (
						<div className="pg-empty">
							{channelsResult.status === 'loading' ? 'Subscribing…' : 'No readable channel.'}
						</div>
					)}
				</Frame>
				{thread && current ? (
					<Frame>
						<div className="pg-thread-header">
							<div>
								<strong>Thread</strong>
								<div className="conversations-drawer__subtitle">{label}</div>
							</div>
							<Button
								buttonStyle="transparent"
								icon={['x']}
								margin={false}
								onClick={() => setThread(null)}
								size="small"
							/>
						</div>
						<ChatThread
							authors={conversation.authors}
							channel={current}
							instance={INSTANCE}
							key={String(thread.id)}
							renderType={renderNote}
							root={conversation.messages.find((message) => message.id === thread.id) ?? thread}
							viewer={viewer}
						/>
					</Frame>
				) : null}
			</div>
			{inspect ? (
				<div className="pg-inspects">
					<Inspect title="useChannels(key)" value={channelsResult} />
					<Inspect
						title="useConversation({ key, channel })"
						value={{
							dividerBefore: conversation.dividerBefore,
							hasNewer: conversation.hasNewer,
							hasOlder: conversation.hasOlder,
							messages: `${conversation.messages.length} in window`,
							status: conversation.status,
							threadReads: conversation.threadReads,
							viewer: conversation.viewer,
						}}
					/>
				</div>
			) : null}
		</div>
	)
}

const DrawerButton = ({
	conversationKey,
	header,
	label,
	subtitle,
	title,
}: {
	conversationKey: string
	header?: ReactNode
	label: string
	subtitle?: string
	title?: string
}) => {
	const { openModal } = useModal()
	const slug = `pg-drawer-${label.replace(/\W+/g, '-').toLowerCase()}`
	return (
		<>
			<button className="pg-button" onClick={() => openModal(slug)} type="button">
				{label}
			</button>
			<ChatDrawer
				conversationKey={conversationKey}
				drawerSlug={slug}
				header={header}
				instance={INSTANCE}
				renderType={renderNote}
				subtitle={subtitle}
				title={title}
			/>
		</>
	)
}

/** A static window for `ChatFeed`: no requests, every flag set by hand. */
const staticConversation = (over: Partial<UseConversationResult> = {}): UseConversationResult => ({
	authors: AUTHORS,
	dividerBefore: null,
	error: null,
	hasNewer: false,
	hasOlder: false,
	jumpToLatest: async () => undefined,
	loadNewer: async () => undefined,
	loadOlder: async () => undefined,
	markSeen: () => undefined,
	messages: [],
	status: 'ready',
	threadReads: {},
	viewer: ME,
	...over,
})

let fixtureId = 10_000
const fixture = (author: string, text: string, minutes: number): WindowMessage => {
	const at = new Date(Date.now() - minutes * 60_000).toISOString()
	return {
		authorKey: author,
		body: lexical.doc(lexical.paragraph(lexical.text(text))),
		channel: 'internal',
		createdAt: at,
		id: fixtureId++,
		key: MOCK_KEYS.gallery,
		text,
		type: 'text',
		updatedAt: at,
	}
}

const feedMessages = [
	fixture(ANNA, 'Yesterday: the passport scan is in.', 26 * 60),
	fixture(ANNA, 'Medical form is still missing.', 26 * 60 - 1),
	fixture(ME, 'Asked the club.', 25 * 60),
	fixture(MARC, 'Heat times need a final check before we publish.', 90),
	fixture(MARC, 'Follow-up, grouped under the same header.', 89),
	fixture(ANNA, 'First unread message: the divider sits above me.', 30),
	fixture(ANNA, 'Second unread.', 29),
	fixture(ME, 'My reply, never unread.', 5),
]

const feedItems: FeedItem[] = [
	{
		at: new Date(Date.now() - 60 * 60_000).toISOString(),
		id: 'audit-1',
		node: <div className="pg-feed-item">Audit · Anna Keller published version 4</div>,
	},
]

const channelsFixture = (unread: [number, number], canCreate = true): ChannelView[] => [
	{ canCreate, label: 'Internal', slug: 'internal', unread: unread[0] },
	{
		canCreate,
		cue: { label: 'Shared · visible to the customer', tone: 'warning' },
		label: { de: 'Geteilt', en: 'Shared' },
		slug: 'shared',
		unread: unread[1],
	},
]

const TabsCase = ({
	channels,
	label,
	reads,
}: {
	channels: ChannelView[]
	label: string
	reads?: boolean
}) => {
	const [active, setActive] = useState(channels[0]?.slug ?? '')
	return (
		<Case label={label}>
			<div className="pg-frame pg-frame--auto">
				<ChatChannelTabs active={active} channels={channels} onChange={setActive} reads={reads} />
				{channels.length < 2 ? <div className="pg-empty">(renders nothing)</div> : null}
			</div>
		</Case>
	)
}

/** Gallery rows read from a live window, so Edit and Delete update in place. */
const MessageGallery = () => {
	const internal = useConversation({ channel: 'internal', key: MOCK_KEYS.gallery, limit: 50 })
	const shared = useConversation({ channel: 'shared', key: MOCK_KEYS.gallery, limit: 50 })
	const all = [...internal.messages, ...shared.messages]
	const authors = { ...internal.authors, ...shared.authors }
	const threadReads = { ...internal.threadReads, ...shared.threadReads }
	const byName = (name: string) => {
		const seed = mockServer.pick(name)
		return seed ? all.find((message) => message.id === seed.id) : undefined
	}
	const row = (
		name: string,
		label: string,
		{ note, props }: { note?: string; props?: Partial<ChatMessageProps> } = {}
	) => {
		const message = byName(name)
		return (
			<Case key={label} label={label} note={note}>
				<div className="pg-frame pg-frame--auto">
					{message ? (
						<ChatMessage
							authors={authors}
							instance={INSTANCE}
							message={message}
							onOpenThread={() => undefined}
							renderType={renderNote}
							threadReadAt={threadReads[String(message.id)]}
							viewer={ME}
							{...props}
						/>
					) : (
						<div className="pg-empty">
							{internal.status === 'ready' ? 'Removed (deleted without replies).' : 'Loading…'}
						</div>
					)}
				</div>
			</Case>
		)
	}
	const staticRow = (label: string, message: WindowMessage, note?: string) => (
		<Case label={label} note={note}>
			<div className="pg-frame pg-frame--auto">
				<ChatMessage authors={AUTHORS} instance={INSTANCE} message={message} viewer={ME} />
			</div>
		</Case>
	)
	return (
		<div className="pg-grid">
			{row('g:plain', 'Someone else')}
			{row('g:own', 'Own message', { note: 'hover: Reply, Edit, Delete (mock answers)' })}
			{row('g:edited', 'Edited, avatar image')}
			{row('g:rich', 'Rich text and mention')}
			{row('g:long', 'Long text and unbroken URL')}
			{row('g:threadNew', 'Thread summary, new replies')}
			{row('g:threadRead', 'Thread summary, all read')}
			{row('g:threadNew', 'Inside a thread (no onOpenThread)', {
				props: { onOpenThread: undefined },
			})}
			{row('g:deleted', 'Deleted root that anchors a thread')}
			{row('g:gone', 'Author deleted')}
			{row('g:customer', 'Customer (second users collection)')}
			{row('g:note', 'Custom type via renderType')}
			{row('g:unknown', 'Unregistered type')}
			{row('g:plain', 'Compact follow-up', { props: { compact: true } })}
			{row('g:edited', 'Compact and edited', { props: { compact: true } })}
			{row('g:plain', 'Slots: header, footer, actions', {
				note: 'open ⋯ for the actions slot',
				props: {
					actions: <PopupList.Button>Pin</PopupList.Button>,
					footer: <div className="pg-slot">footer slot</div>,
					header: <div className="pg-slot">header slot replaces name and time</div>,
				},
			})}
			{staticRow('Sending (optimistic)', {
				...fixture(ME, 'On its way…', 0),
				clientId: 'x',
				sendStatus: 'sending',
			})}
			{staticRow(
				'Send failed',
				{
					...fixture(ME, 'This one did not make it.', 0),
					clientId: 'y',
					sendStatus: 'failed',
				},
				'ChatFeed hides these; the composer keeps the text'
			)}
		</div>
	)
}

/** The thread with new replies from the busy conversation. */
const ThreadStory = () => {
	const { channels, viewer } = useChannels(MOCK_KEYS.busy)
	const conversation = useConversation({ channel: 'internal', key: MOCK_KEYS.busy })
	const seed = mockServer.pick('threadNew')
	const root = conversation.messages.find((message) => message.id === seed?.id)
	const channel = channels.find((item) => item.slug === 'internal')
	return (
		<Frame>
			{root && channel ? (
				<ChatThread
					authors={conversation.authors}
					channel={channel}
					instance={INSTANCE}
					renderType={renderNote}
					root={root}
					viewer={viewer}
				/>
			) : (
				<div className="pg-empty">Loading…</div>
			)}
		</Frame>
	)
}

const Incoming = ({ label, parent }: { label: string; parent?: string }) => (
	<button
		className="pg-button"
		onClick={() => mockServer.incoming({ author: ANNA, key: MOCK_KEYS.busy, parent })}
		type="button"
	>
		{label}
	</button>
)

export const stories: Story[] = [
	{
		backend: 'live',
		description:
			'The real ChatTrigger with the seeded persons and media, as comments() injects it into document controls. Opens the real drawer.',
		group: 'Live (seeded data)',
		id: 'live-triggers',
		render: ({ live }) => (
			<div className="pg-doc-controls">
				{live.map((target) => (
					<Case key={target.key} label={target.label} note={target.key}>
						<ChatTrigger conversationKey={target.key} instance={INSTANCE} />
					</Case>
				))}
			</div>
		),
		title: 'Triggers and drawer',
	},
	{
		backend: 'live',
		description:
			'Tabs, feed, composer and thread composed by hand from the exported primitives and hooks, on the busiest seeded person. Sends are real.',
		group: 'Live (seeded data)',
		id: 'live-inline',
		render: ({ live }) =>
			live[0] ? <InlineConversation conversationKey={live[0].key} /> : <div>No seeded person.</div>,
		title: 'Inline composition',
	},
	{
		backend: 'mock',
		description:
			'Trigger states: many messages with unread, empty, read-only single channel, and a long unread backlog. Each opens its drawer.',
		group: 'Composed (mock backend)',
		id: 'mock-triggers',
		render: () => (
			<div className="pg-doc-controls">
				<Case label="Busy, unread">
					<ChatTrigger conversationKey={MOCK_KEYS.busy} instance={INSTANCE} />
				</Case>
				<Case label="Empty">
					<ChatTrigger conversationKey={MOCK_KEYS.empty} instance={INSTANCE} />
				</Case>
				<Case label="Read-only, one channel">
					<ChatTrigger conversationKey={MOCK_KEYS.readonly} instance={INSTANCE} />
				</Case>
				<Case label="130 unread">
					<ChatTrigger conversationKey={MOCK_KEYS.many} instance={INSTANCE} />
				</Case>
				<Case label="No access (unknown key)">
					<ChatTrigger conversationKey="custom:playground:forbidden" instance={INSTANCE} />
				</Case>
			</div>
		),
		title: 'Trigger states',
	},
	{
		backend: 'mock',
		description:
			'ChatDrawer on its own, with the title, subtitle and header slot a project can pass. The thread opens as a second drawer stacked on top.',
		group: 'Composed (mock backend)',
		id: 'mock-drawer',
		render: () => (
			<div className="pg-row">
				<DrawerButton conversationKey={MOCK_KEYS.busy} label="Busy" subtitle="Jana Nováková" />
				<DrawerButton
					conversationKey={MOCK_KEYS.busy}
					header={<span className="pg-slot">header slot</span>}
					label="Custom title and header slot"
					subtitle="Subtitle"
					title="Discussion"
				/>
				<DrawerButton conversationKey={MOCK_KEYS.empty} label="Empty" />
				<DrawerButton conversationKey={MOCK_KEYS.readonly} label="Read-only" />
				<DrawerButton conversationKey={MOCK_KEYS.many} label="Opens at first unread" />
			</div>
		),
		title: 'Drawer',
	},
	{
		backend: 'mock',
		description: (
			<>
				The same hand composition on fixtures: day separators, grouping, the divider, threads, a
				deleted root, a custom type. Use the toolbar to post as Anna, slow requests down or make
				sends fail.
			</>
		),
		group: 'Composed (mock backend)',
		id: 'mock-inline',
		render: () => (
			<div className="pg-stack">
				<div className="pg-row">
					<Incoming label="Anna posts in Internal" />
					<Incoming
						label="Anna replies in the thread"
						parent={String(mockServer.pick('threadNew')?.id ?? '')}
					/>
					<button
						className="pg-button"
						onClick={() =>
							mockServer.incoming({ author: CUSTOMER, channel: 'shared', key: MOCK_KEYS.busy })
						}
						type="button"
					>
						Customer posts in Shared
					</button>
				</div>
				<InlineConversation conversationKey={MOCK_KEYS.busy} />
			</div>
		),
		title: 'Inline composition',
	},
	{
		backend: 'mock',
		description:
			'130 unread, more than a page: the feed opens around the first unread with the divider, and "Jump to latest" replaces the window.',
		group: 'Composed (mock backend)',
		id: 'mock-many',
		render: () => <InlineConversation conversationKey={MOCK_KEYS.many} />,
		title: 'Long unread backlog',
	},
	{
		backend: 'mock',
		description: 'ChatThread on its own: the root, its replies as a window, a reply composer.',
		group: 'Composed (mock backend)',
		id: 'mock-thread',
		render: () => <ThreadStory />,
		title: 'Thread',
	},
	{
		backend: 'mock',
		description:
			'ChatComposer variants on the plugin’s own Lexical editor. Sends go to the mock sandbox. Try @ for mentions, / for commands, Ctrl+K for a link, and markdown (**bold**, - list, [text](url)).',
		group: 'Primitives',
		id: 'composer',
		render: () => (
			<div className="pg-grid">
				<Case label="Toolbar bottom (default)" note="internal cue with Switch to">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							cue={{ label: 'Internal · staff of this tenant only', tone: 'neutral' }}
							cueAction={{ label: 'Switch to Shared', onClick: () => undefined }}
							instance={INSTANCE}
							placeholder="Write a comment… @ to mention"
						/>
					</div>
				</Case>
				<Case label="Warning cue" note="an external channel">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="shared"
							conversationKey={MOCK_KEYS.sandbox}
							cue={{ label: 'Shared · visible to the customer', tone: 'warning' }}
							cueAction={{ label: 'Switch to Internal', onClick: () => undefined }}
							instance={INSTANCE}
						/>
					</div>
				</Case>
				<Case label="Toolbar top" note="lists in the toolbar too">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							features={({ defaultFeatures }) =>
								defaultFeatures.map((feature) =>
									feature.key === 'lists' ? listsFeature({ toolbar: true }) : feature
								)
							}
							instance={INSTANCE}
							toolbar="top"
						/>
					</div>
				</Case>
				<Case label="Toolbar none" note="everything through / and markdown">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							instance={INSTANCE}
							placeholder="Write a message… / for commands, @ to mention"
							toolbar="none"
						/>
					</div>
				</Case>
				<Case
					label="Custom feature: text color"
					note="a dropdown in the toolbar, a Color group in /"
				>
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							features={({ defaultFeatures }) => [...defaultFeatures, textColorFeature()]}
							instance={INSTANCE}
							placeholder="Select text, then the A▾ button, or type /red"
						/>
					</div>
				</Case>
				<Case label="Overflow: many buttons, narrow" note="what does not fit moves to ⋯">
					<div className="pg-frame pg-frame--auto pg-pad" style={{ maxWidth: 380 }}>
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							features={({ defaultFeatures }) => [
								...defaultFeatures.map((feature) =>
									feature.key === 'lists' ? listsFeature({ toolbar: true }) : feature
								),
								extraFormatsFeature(),
								textColorFeature(),
							]}
							instance={INSTANCE}
						/>
					</div>
				</Case>
				<Case label="toolbar.items: pick and order" note="['mention', 'color', 'bold', 'italic']">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							features={({ defaultFeatures }) => [...defaultFeatures, textColorFeature()]}
							instance={INSTANCE}
							toolbar={{ items: ['mention', 'color', 'bold', 'italic'], placement: 'bottom' }}
						/>
					</div>
				</Case>
				<Case label="Neutral cue, thread reply">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							cue={{ label: 'Replying in thread', tone: 'neutral' }}
							instance={INSTANCE}
							placeholder="Reply in thread…"
						/>
					</div>
				</Case>
				<Case label="Mod+Enter, above and actions slots">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							above={<div className="pg-slot">above slot</div>}
							actions={
								<Button buttonStyle="secondary" margin={false} size="small">
									Attach
								</Button>
							}
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							instance={INSTANCE}
							submitOn="mod+enter"
						/>
					</div>
				</Case>
				<Case label="Disabled reason" note="read-only channel">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							disabledReason="This channel is read-only."
							instance={INSTANCE}
						/>
					</div>
				</Case>
				<Case label="Editing" note="initialBody, Save and Cancel">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							initialBody={lexical.doc(
								lexical.paragraph(lexical.text('Existing text with a '), lexical.mention(ANNA))
							)}
							instance={INSTANCE}
							onCancel={() => undefined}
							onSave={async () => undefined}
							autoFocus={false}
						/>
					</div>
				</Case>
			</div>
		),
		title: 'Composer',
	},
	{
		backend: 'mock',
		description: 'ChatMessage in every state. Rows come from the mock, so Edit and Delete work.',
		group: 'Primitives',
		id: 'messages',
		render: () => <MessageGallery />,
		title: 'Message',
	},
	{
		backend: 'mock',
		description: 'ChatFeed with a hand-set window (no requests): each state the hook can report.',
		group: 'Primitives',
		id: 'feed',
		render: () => (
			<div className="pg-grid">
				<Case label="Loading">
					<Frame height={260}>
						<ChatFeed
							conversation={staticConversation({ status: 'loading' })}
							instance={INSTANCE}
						/>
					</Frame>
				</Case>
				<Case label="Error">
					<Frame height={260}>
						<ChatFeed conversation={staticConversation({ status: 'error' })} instance={INSTANCE} />
					</Frame>
				</Case>
				<Case label="Empty">
					<Frame height={260}>
						<ChatFeed
							conversation={staticConversation()}
							empty="No messages in Internal yet."
							instance={INSTANCE}
						/>
					</Frame>
				</Case>
				<Case label="Days, grouping, divider">
					<Frame height={420}>
						<ChatFeed
							conversation={staticConversation({
								dividerBefore: String(feedMessages[5]?.id),
								messages: feedMessages,
							})}
							instance={INSTANCE}
						/>
					</Frame>
				</Case>
				<Case label="hasOlder: Load earlier">
					<Frame height={260}>
						<ChatFeed
							conversation={staticConversation({ hasOlder: true, messages: feedMessages.slice(3) })}
							instance={INSTANCE}
						/>
					</Frame>
				</Case>
				<Case label="hasNewer: Jump to latest">
					<Frame height={260}>
						<ChatFeed
							conversation={staticConversation({
								hasNewer: true,
								messages: feedMessages.slice(0, 5),
							})}
							instance={INSTANCE}
						/>
					</Frame>
				</Case>
				<Case label="items: foreign rows interleaved">
					<Frame height={420}>
						<ChatFeed
							conversation={staticConversation({ messages: feedMessages.slice(3) })}
							instance={INSTANCE}
							items={feedItems}
						/>
					</Frame>
				</Case>
			</div>
		),
		title: 'Feed states',
	},
	{
		backend: 'mock',
		description: 'ChatChannelTabs: counts, the 99+ cap, reads off, and a single channel.',
		group: 'Primitives',
		id: 'tabs',
		render: () => (
			<div className="pg-grid">
				<TabsCase channels={channelsFixture([0, 0])} label="No unread" />
				<TabsCase channels={channelsFixture([3, 1])} label="Unread counts" />
				<TabsCase channels={channelsFixture([140, 12])} label="99+ cap" />
				<TabsCase channels={channelsFixture([3, 1])} label="reads: false" reads={false} />
				<TabsCase channels={channelsFixture([2, 0]).slice(0, 1)} label="One channel" />
			</div>
		),
		title: 'Channel tabs',
	},
	{
		backend: 'mock',
		description: 'Avatar: initials on a hue derived from the user key, an image, a deleted user.',
		group: 'Primitives',
		id: 'avatars',
		render: () => (
			<div className="pg-stack">
				<Case label="Sizes">
					<div className="pg-row">
						{[20, 28, 36, 48].map((size) => (
							<Avatar author={AUTHORS[ANNA]} key={size} size={size} userKey={ANNA} />
						))}
					</div>
				</Case>
				<Case label="Kinds" note="initials, image, customer, deleted, no name">
					<div className="pg-row">
						<Avatar author={AUTHORS[ME]} userKey={ME} />
						<Avatar author={AUTHORS[MARC]} userKey={MARC} />
						<Avatar author={AUTHORS[CUSTOMER]} userKey={CUSTOMER} />
						<Avatar author={AUTHORS[GONE]} userKey={GONE} />
						<Avatar userKey="users:unknown" />
					</div>
				</Case>
				<Case label="Hue spread" note="one colour per user key">
					<div className="pg-row">
						{Array.from({ length: 16 }, (_, index) => (
							<Avatar
								author={{ name: `User ${String.fromCharCode(65 + index)}` }}
								key={index}
								userKey={`users:${index + 1}`}
							/>
						))}
					</div>
				</Case>
			</div>
		),
		title: 'Avatar',
	},
]
