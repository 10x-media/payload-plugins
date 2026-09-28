'use client'

import {
	ChatChannelTabs,
	ChatComponentsProvider,
	ChatComposer,
	ChatFeed,
	type ChatSlotProps,
	ChatTrigger,
	useChatComponents,
} from '@10x-media/conversations/client'
import { useChannels, type WindowMessage } from '@10x-media/conversations/react'
import { type ReactNode, useState } from 'react'
import { textColorFeature } from '../features/textColor'
import { ANNA, IMPORT, MARC, ME, MOCK_KEYS, SYSTEM_TYPE } from './mockServer'
import {
	channelsFixture,
	DrawerButton,
	Frame,
	fixture,
	InlineConversation,
	renderNote,
	type Story,
	staticConversation,
	ThreadStory,
} from './stories'

const INSTANCE = 'comments'

/**
 * One docs screenshot: `packages/conversations/videos/screenshots.video.ts`
 * crops to `[data-shot="<name>"]` and writes `<name>.png` into the docs app.
 * A fixed width, so a shot comes out the same size on every run.
 */
const Shot = ({
	children,
	name,
	width = 640,
}: {
	children: ReactNode
	name: string
	width?: number
}) => (
	<div className="pg-shot" data-shot={name} style={{ width }}>
		{children}
	</div>
)

/** The mock's `playground.system` type: a whole-row note, as `layout: 'bare'` draws it. */
const renderSystem = (message: WindowMessage): ReactNode => {
	if (message.type !== SYSTEM_TYPE) return renderNote(message)
	return (
		<div className="pg-system-note">
			<span aria-hidden="true">ⓘ</span>
			<span>
				<strong>CSV import:</strong> {(message.data as { text?: string } | undefined)?.text}
			</span>
		</div>
	)
}

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const bareMessages: WindowMessage[] = [
	fixture(ANNA, 'Uploaded the club list for the spring season.', 42),
	{
		authorKey: IMPORT,
		channel: 'internal',
		createdAt: at(41),
		data: { text: 'Birth date inferred for 3 athletes: only the year was given.' },
		id: 'system-1',
		key: MOCK_KEYS.gallery,
		type: SYSTEM_TYPE,
		updatedAt: at(41),
	},
	fixture(ANNA, 'Can someone check those three before Friday?', 40),
	fixture(MARC, 'On it.', 12),
]

/** Bare rows group nothing: the store's type layouts come from a subscribe, so one is mounted. */
const BareFeed = () => {
	useChannels(MOCK_KEYS.gallery)
	return (
		<Frame height={300}>
			<ChatFeed
				conversation={staticConversation({ messages: bareMessages })}
				instance={INSTANCE}
				renderType={renderSystem}
			/>
		</Frame>
	)
}

/** A labelled outline where a slot renders. */
const marker =
	(name: string) =>
	({ message }: ChatSlotProps) => (
		<div className="pg-slot-marker">
			{name}
			{message ? <span className="pg-slot-marker__note"> · per message</span> : null}
		</div>
	)

const SLOT_MARKERS = {
	composerAbove: [marker('composerAbove')],
	drawerHeader: [marker('drawerHeader')],
	messageActions: [marker('messageActions')],
	messageFooter: [marker('messageFooter')],
	messageQuickActions: [marker('messageQuickActions')],
}

/** Every config slot of the drawer filled with a marker, over the instance's real components. */
const SlotMap = () => {
	const current = useChatComponents(INSTANCE)
	const [components] = useState(() => ({ ...current, slots: SLOT_MARKERS }))
	return (
		<ChatComponentsProvider components={components} instance={INSTANCE}>
			<DrawerButton
				conversationKey={MOCK_KEYS.busy}
				label="Open the slot map"
				subtitle="Jana Nováková"
			/>
		</ChatComponentsProvider>
	)
}

/**
 * Stills for the docs, one `data-shot` each. The screenshot scene opens each
 * story by its hash, does what the shot needs (open a menu, type a command)
 * and crops to the element. Deterministic mock data, dark theme.
 */
export const shots: Story[] = [
	{
		backend: 'mock',
		description: 'Tabs, feed and composer of one conversation, as the drawer shows them.',
		group: 'Docs shots',
		id: 'shot-panel',
		render: () => (
			<Shot name="panel">
				<InlineConversation conversationKey={MOCK_KEYS.busy} inspect={false} />
			</Shot>
		),
		title: 'Panel',
	},
	{
		backend: 'mock',
		description: 'A thread: the root, its replies, a reply composer.',
		group: 'Docs shots',
		id: 'shot-thread',
		render: () => (
			<Shot name="thread">
				<ThreadStory />
			</Shot>
		),
		title: 'Thread',
	},
	{
		backend: 'mock',
		description: 'The Comments button with a count and the unread dot, and with nothing yet.',
		group: 'Docs shots',
		id: 'shot-trigger',
		render: () => (
			<Shot name="trigger" width={360}>
				<div className="pg-row pg-pad">
					<ChatTrigger conversationKey={MOCK_KEYS.busy} instance={INSTANCE} />
					<ChatTrigger conversationKey={MOCK_KEYS.empty} instance={INSTANCE} />
				</div>
			</Shot>
		),
		title: 'Trigger',
	},
	{
		backend: 'mock',
		description: 'Channel tabs with unread counts.',
		group: 'Docs shots',
		id: 'shot-tabs',
		render: () => (
			<Shot name="tabs" width={420}>
				<div className="pg-frame pg-frame--auto">
					<ChatChannelTabs
						active="internal"
						channels={channelsFixture([3, 1])}
						onChange={() => undefined}
					/>
				</div>
			</Shot>
		),
		title: 'Channel tabs',
	},
	{
		backend: 'mock',
		description: 'A feed: days, grouping, the "New messages" divider.',
		group: 'Docs shots',
		id: 'shot-feed',
		render: () => {
			const messages = [
				fixture(ANNA, 'The passport scan is in.', 26 * 60),
				fixture(ANNA, 'Medical form is still missing.', 26 * 60 - 1),
				fixture(ME, 'Asked the club to send it again.', 25 * 60),
				fixture(MARC, 'Heat times need a final check before we publish.', 90),
				fixture(MARC, 'I will take the morning heats.', 89),
				fixture(ANNA, 'Medical form arrived, it looks good.', 30),
				fixture(ANNA, 'Uploading it now.', 29),
			]
			return (
				<Shot name="feed">
					<Frame height={460}>
						<ChatFeed
							conversation={staticConversation({
								dividerBefore: String(messages[5]?.id),
								messages,
							})}
							instance={INSTANCE}
						/>
					</Frame>
				</Shot>
			)
		},
		title: 'Feed',
	},
	{
		backend: 'mock',
		description: 'A `layout: bare` system note between chat messages, from a system author.',
		group: 'Docs shots',
		id: 'shot-bare',
		render: () => (
			<Shot name="bare-layout">
				<BareFeed />
			</Shot>
		),
		title: 'Bare layout',
	},
	{
		backend: 'mock',
		description:
			'The composer with a warning cue; the scene opens the / menu and the @ menu for their own shots.',
		group: 'Docs shots',
		id: 'shot-composer',
		render: () => (
			<div className="pg-stack">
				<Shot name="composer">
					<div className="pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="shared"
							conversationKey={MOCK_KEYS.sandbox}
							cue={{ label: 'Shared · visible to the customer', tone: 'warning' }}
							cueAction={{ label: 'Switch to Internal', onClick: () => undefined }}
							instance={INSTANCE}
						/>
					</div>
				</Shot>
				<Shot name="composer-commands">
					<div className="pg-shot__menu-room pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							features={({ defaultFeatures }) => [...defaultFeatures, textColorFeature()]}
							instance={INSTANCE}
						/>
					</div>
				</Shot>
				<Shot name="composer-mention">
					<div className="pg-shot__menu-room pg-frame pg-frame--auto pg-pad">
						<ChatComposer
							channel="internal"
							conversationKey={MOCK_KEYS.sandbox}
							instance={INSTANCE}
						/>
					</div>
				</Shot>
			</div>
		),
		title: 'Composer',
	},
	{
		backend: 'mock',
		description:
			'Every config slot filled with a labelled marker. The scene opens the drawer and a message menu.',
		group: 'Docs shots',
		id: 'shot-slots',
		render: () => <SlotMap />,
		title: 'Slot map',
	},
]
