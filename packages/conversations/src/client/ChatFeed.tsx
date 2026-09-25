'use client'

import {
	Fragment,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'

import type { UseConversationResult } from '../react/hooks'
import type { WindowMessage } from '../react/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatMessage } from './ChatMessage'
import { dayKey } from './time'
import { useDelayedFlag } from './useDelayedFlag'
import './conversations.css'

/** A foreign row shown in the feed at its time, e.g. an audit entry. */
export type FeedItem = { at: string; id: string; node: ReactNode }

export type ChatFeedProps = {
	conversation: UseConversationResult
	/** Shown when the channel has no messages. */
	empty?: ReactNode
	instance: string
	/** Rows from elsewhere, interleaved by timestamp. */
	items?: FeedItem[]
	onOpenThread?: (message: WindowMessage) => void
	/** Replaces the default message renderer. */
	renderMessage?: (args: {
		compact: boolean
		message: WindowMessage
		conversation: UseConversationResult
	}) => ReactNode
	/** Renders messages whose `type` is not `text`. */
	renderType?: (message: WindowMessage) => ReactNode
}

/** Follow-ups within this window from the same author drop their header. */
const GROUP_MS = 5 * 60 * 1000

/** Close enough to the bottom to count as "at the end". */
const END_SLACK_PX = 48

const isCompact = (previous: WindowMessage | undefined, message: WindowMessage) =>
	Boolean(previous) &&
	previous?.authorKey === message.authorKey &&
	!previous.deletedAt &&
	!message.deletedAt &&
	(previous.replyCount ?? 0) === 0 &&
	dayKey(previous.createdAt) === dayKey(message.createdAt) &&
	new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_MS

/**
 * A scrolling window over a feed or thread. Opens at the divider or the
 * bottom, keeps its place while older pages load in above, sticks to the
 * bottom while the reader is there, and shows "N new" when they are not.
 * Reaching the end marks the conversation seen.
 */
export const ChatFeed = ({
	conversation,
	empty,
	instance,
	items = [],
	onOpenThread,
	renderMessage,
	renderType,
}: ChatFeedProps) => {
	const { i18n, t } = useTranslation()
	const scroller = useRef<HTMLDivElement>(null)
	const top = useRef<HTMLDivElement>(null)
	const atEnd = useRef(true)
	const opened = useRef(false)
	const anchor = useRef<null | { height: number; top: number }>(null)
	const [unseen, setUnseen] = useState(0)
	const lastCount = useRef(0)
	const { dividerBefore, hasNewer, hasOlder, loadNewer, loadOlder, markSeen, messages, status } =
		conversation

	const shown = messages.filter((message) => message.sendStatus !== 'failed')

	const checkEnd = useCallback(() => {
		const element = scroller.current
		if (!element) return
		atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < END_SLACK_PX
		if (atEnd.current && !hasNewer) {
			setUnseen(0)
			if (document.visibilityState === 'visible') markSeen()
		}
	}, [hasNewer, markSeen])

	// A quick load shows nothing in between; a slow one a skeleton that does not blink.
	const skeleton = useDelayedFlag(status === 'loading' && shown.length === 0)

	// First paint of a loaded window: the divider if there is one, else the bottom.
	useLayoutEffect(() => {
		const element = scroller.current
		if (!element || status !== 'ready' || skeleton || opened.current) return
		opened.current = true
		const divider = dividerBefore
			? element.querySelector<HTMLElement>('.conversations-feed__divider')
			: null
		if (divider) {
			element.scrollTop = divider.offsetTop - 16
		} else {
			element.scrollTop = element.scrollHeight
		}
		checkEnd()
	}, [checkEnd, dividerBefore, skeleton, status])

	// Keep the reader's place when rows are added above; follow the bottom when there.
	useLayoutEffect(() => {
		const element = scroller.current
		if (!element || !opened.current) return
		if (anchor.current) {
			element.scrollTop = anchor.current.top + (element.scrollHeight - anchor.current.height)
			anchor.current = null
		} else if (atEnd.current && !hasNewer) {
			element.scrollTop = element.scrollHeight
		}
		const added = shown.length - lastCount.current
		if (added > 0 && !atEnd.current && lastCount.current > 0) {
			setUnseen((count) => count + added)
		}
		lastCount.current = shown.length
		checkEnd()
	})

	const older = useCallback(async () => {
		const element = scroller.current
		if (!element || !hasOlder) return
		anchor.current = { height: element.scrollHeight, top: element.scrollTop }
		await loadOlder()
	}, [hasOlder, loadOlder])

	useEffect(() => {
		const element = top.current
		if (!element || !hasOlder || status !== 'ready') return
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void older()
			},
			{ root: scroller.current, rootMargin: '200px 0px 0px 0px' }
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [hasOlder, older, status])

	useEffect(() => {
		const onVisible = () => checkEnd()
		document.addEventListener('visibilitychange', onVisible)
		return () => document.removeEventListener('visibilitychange', onVisible)
	}, [checkEnd])

	const toBottom = async () => {
		if (hasNewer) {
			await conversation.jumpToLatest()
		}
		const element = scroller.current
		if (element) element.scrollTop = element.scrollHeight
		setUnseen(0)
	}

	type Row = { at: string; item?: FeedItem; message?: WindowMessage }
	const rows: Row[] = [
		...shown.map((message) => ({ at: message.createdAt, message })),
		...items.map((item) => ({ at: item.at, item })),
	].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

	const dayLabel = (value: string) => {
		const key = dayKey(value)
		if (key === dayKey(new Date().toISOString())) return t(keys.today)
		if (key === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return t(keys.yesterday)
		return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(value))
	}

	let previousMessage: WindowMessage | undefined
	let previousDay: null | string = null

	return (
		<div className="conversations-feed">
			<div className="conversations-feed__scroller" onScroll={checkEnd} ref={scroller}>
				<div ref={top} />
				{hasOlder ? (
					<div className="conversations-feed__older">
						<button className="conversations-button" onClick={() => void older()} type="button">
							{t(keys.loadEarlier)}
						</button>
					</div>
				) : null}
				{skeleton ? <div className="conversations-feed__skeleton" /> : null}
				{status === 'error' ? (
					<div className="conversations-feed__empty">{t(keys.couldNotLoad)}</div>
				) : null}
				{status === 'ready' && !skeleton && rows.length === 0 ? (
					<div className="conversations-feed__empty">{empty}</div>
				) : null}
				{(skeleton ? [] : rows).map((row) => {
					const day = dayKey(row.at)
					const showDay = day !== previousDay
					previousDay = day
					if (row.item) {
						previousMessage = undefined
						return (
							<Fragment key={`item:${row.item.id}`}>
								{showDay ? <div className="conversations-feed__day">{dayLabel(row.at)}</div> : null}
								{row.item.node}
							</Fragment>
						)
					}
					const message = row.message as WindowMessage
					const compact = !showDay && isCompact(previousMessage, message)
					previousMessage = message
					const divider = dividerBefore === String(message.id)
					return (
						<Fragment key={message.clientId ?? String(message.id)}>
							{showDay ? <div className="conversations-feed__day">{dayLabel(row.at)}</div> : null}
							{divider ? (
								<div className="conversations-feed__divider">
									<span>{t(keys.newMessages)}</span>
								</div>
							) : null}
							{renderMessage ? (
								renderMessage({ compact: compact && !divider, conversation, message })
							) : (
								<ChatMessage
									authors={conversation.authors}
									compact={compact && !divider}
									instance={instance}
									message={message}
									onOpenThread={onOpenThread}
									renderType={renderType}
									threadReadAt={conversation.threadReads[String(message.id)]}
									viewer={conversation.viewer}
								/>
							)}
						</Fragment>
					)
				})}
				{hasNewer ? (
					<div className="conversations-feed__older">
						<button className="conversations-button" onClick={() => void loadNewer()} type="button">
							{t(keys.loadNewer)}
						</button>
					</div>
				) : null}
			</div>
			{unseen > 0 || hasNewer ? (
				<button className="conversations-feed__pill" onClick={() => void toBottom()} type="button">
					{hasNewer ? t(keys.jumpToLatest) : `${unseen} ${t(keys.newMessages).toLowerCase()} ↓`}
				</button>
			) : null}
		</div>
	)
}
