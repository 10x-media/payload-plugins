'use client'

import { ChatComposer, ChatFeed, ChatThread } from '@10x-media/conversations/client'
import {
	ChatScope,
	collectionKey,
	useChannels,
	useConversation,
	useUnread,
	type WindowMessage,
} from '@10x-media/conversations/react'
import { useConfig } from '@payloadcms/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import './chat.css'

export type ChatRoom = { id: string; name: string; topic: string }

const INSTANCE = 'chat'
const CHANNEL = 'messages'

const roomKey = (room: ChatRoom) => collectionKey('rooms', room.id)

const Hash = () => <span className="chat-app__hash">#</span>

const CloseIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
	</svg>
)

/** The room list: unread rooms in bold with their count, and a field to add a room. */
const Sidebar = ({
	activeId,
	onSelect,
	rooms,
}: {
	activeId: null | string
	onSelect: (id: string) => void
	rooms: ChatRoom[]
}) => {
	const unread = useUnread(rooms.map(roomKey))
	const { config } = useConfig()
	const router = useRouter()
	const [adding, setAdding] = useState(false)
	const [name, setName] = useState('')

	const create = async () => {
		const clean = name.trim().toLowerCase().replace(/\s+/g, '-')
		if (!clean) return
		const res = await fetch(`${config.serverURL}${config.routes.api}/rooms`, {
			body: JSON.stringify({ name: clean }),
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
		})
		if (!res.ok) return
		const { doc } = (await res.json()) as { doc: { id: number | string } }
		setName('')
		setAdding(false)
		onSelect(String(doc.id))
		router.refresh()
	}

	return (
		<aside className="chat-app__sidebar">
			<div className="chat-app__workspace">Spring cup</div>
			<div className="chat-app__section">Rooms</div>
			<nav className="chat-app__rooms">
				{rooms.map((room) => {
					const count = unread[roomKey(room)]?.[CHANNEL] ?? 0
					return (
						<button
							className={`chat-app__room${room.id === activeId ? ' chat-app__room--active' : ''}${count > 0 ? ' chat-app__room--unread' : ''}`}
							key={room.id}
							onClick={() => onSelect(room.id)}
							type="button"
						>
							<Hash />
							<span className="chat-app__room-name">{room.name}</span>
							{count > 0 && room.id !== activeId ? (
								<span className="chat-app__badge">{count > 99 ? '99+' : count}</span>
							) : null}
						</button>
					)
				})}
			</nav>
			{adding ? (
				<input
					// biome-ignore lint/a11y/noAutofocus: shown on an explicit "Add a room" click.
					autoFocus
					className="chat-app__new"
					onBlur={() => setAdding(false)}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') void create()
						if (event.key === 'Escape') setAdding(false)
					}}
					placeholder="room-name"
					value={name}
				/>
			) : (
				<button className="chat-app__add" onClick={() => setAdding(true)} type="button">
					+ Add a room
				</button>
			)}
		</aside>
	)
}

/** One room: header, feed, composer; a thread opens in the side pane. */
const Room = ({
	onOpenThread,
	room,
	thread,
	onCloseThread,
}: {
	onCloseThread: () => void
	onOpenThread: (message: WindowMessage) => void
	room: ChatRoom
	thread: null | WindowMessage
}) => {
	const key = roomKey(room)
	const { channels, status, viewer } = useChannels(key)
	const channel = channels.find((entry) => entry.slug === CHANNEL)
	const conversation = useConversation({ channel: CHANNEL, key })
	const root = thread
		? (conversation.messages.find((message) => message.id === thread.id) ?? thread)
		: null

	return (
		<>
			<section className="chat-app__main">
				<header className="chat-app__header">
					<h2 className="chat-app__title">
						<Hash />
						{room.name}
					</h2>
					{room.topic ? <div className="chat-app__topic">{room.topic}</div> : null}
				</header>
				{channel ? (
					<>
						<ChatFeed
							conversation={conversation}
							empty={
								<div className="chat-app__start">
									<strong>This is the very beginning of #{room.name}.</strong>
									{room.topic ? <div>{room.topic}</div> : null}
								</div>
							}
							instance={INSTANCE}
							onOpenThread={onOpenThread}
						/>
						<div className="chat-app__composer">
							<ChatComposer
								channel={CHANNEL}
								conversationKey={key}
								disabledReason={channel.canCreate ? undefined : 'You cannot post in this room.'}
								instance={INSTANCE}
								placeholder={`Message #${room.name}`}
							/>
						</div>
					</>
				) : (
					<div className="chat-app__empty">
						{status === 'loading' ? 'Loading…' : 'You cannot read this room.'}
					</div>
				)}
			</section>
			{root && channel ? (
				<aside className="chat-app__thread">
					<header className="chat-app__header chat-app__header--thread">
						<div>
							<h3 className="chat-app__title">Thread</h3>
							<div className="chat-app__topic">#{room.name}</div>
						</div>
						<button
							aria-label="Close thread"
							className="chat-app__close"
							onClick={onCloseThread}
							type="button"
						>
							<CloseIcon />
						</button>
					</header>
					<ChatThread
						authors={conversation.authors}
						channel={channel}
						instance={INSTANCE}
						key={String(root.id)}
						root={root}
						viewer={viewer}
					/>
				</aside>
			) : null}
		</>
	)
}

/** Rooms on the left, the open room in the middle, its thread on the right. */
export const ChatApp = ({ rooms }: { rooms: ChatRoom[] }) => {
	const router = useRouter()
	const pathname = usePathname()
	const params = useSearchParams()
	const [thread, setThread] = useState<null | WindowMessage>(null)
	const activeId = params.get('room') ?? rooms[0]?.id ?? null
	const room = rooms.find((entry) => entry.id === activeId)

	const select = (id: string) => {
		setThread(null)
		router.replace(`${pathname}?room=${id}`, { scroll: false })
	}

	return (
		<ChatScope instance={INSTANCE}>
			<div className="chat-app">
				<Sidebar activeId={activeId} onSelect={select} rooms={rooms} />
				{room ? (
					<Room
						key={room.id}
						onCloseThread={() => setThread(null)}
						onOpenThread={setThread}
						room={room}
						thread={thread}
					/>
				) : (
					<section className="chat-app__main">
						<div className="chat-app__empty">No rooms yet. Add one on the left.</div>
					</section>
				)}
			</div>
		</ChatScope>
	)
}
