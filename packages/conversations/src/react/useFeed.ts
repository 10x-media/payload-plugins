'use client'

import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import { buildFeedRows, type FeedItem, type FeedRow } from './feed'
import type { UseConversationResult } from './hooks'
import { useOptionalChatStore } from './provider'
import { useDelayedFlag } from './useDelayedFlag'

/** Close enough to the bottom to count as "at the end". */
const END_SLACK_PX = 48

/** The attribute a renderer puts on its "New messages" divider, so the feed can open at it. */
export const FEED_DIVIDER_ATTRIBUTE = 'data-feed-divider'

export type UseFeedResult = {
	/** Put on an empty element at the very bottom of the scroller: reaching it loads newer pages. */
	bottomRef: RefObject<HTMLDivElement | null>
	hasNewer: boolean
	hasOlder: boolean
	/** Load the page before the first row, keeping the reader's place. */
	loadOlder: () => Promise<void>
	/** Put on the scroller. */
	onScroll: () => void
	rows: FeedRow[]
	/** Put on the scrolling element. */
	scrollerRef: RefObject<HTMLDivElement | null>
	/** Show "jump to latest": newer pages exist, or messages arrived below the reader. */
	showJump: boolean
	/** A slow first load: show a placeholder (never for a quick one, never a blink). */
	skeleton: boolean
	status: UseConversationResult['status']
	/** Scroll to the latest message, loading it first when the window is not there. */
	toBottom: () => Promise<void>
	/** Put on an empty element at the very top of the scroller: reaching it loads older pages. */
	topRef: RefObject<HTMLDivElement | null>
	/** Messages that arrived below while the reader was scrolled up. */
	unseen: number
}

/**
 * The behaviour of a scrolling feed or thread, for any markup: opens at the
 * "New messages" divider (an element with `data-feed-divider`) or the bottom,
 * keeps the reader's place while older pages load in above, follows the
 * bottom while the reader is there, counts what arrives below otherwise, and
 * loads pages as the top or bottom comes into view. Reaching the end marks
 * the conversation seen.
 */
export const useFeed = ({
	conversation,
	items,
}: {
	conversation: UseConversationResult
	/** Rows from elsewhere, interleaved by time. */
	items?: FeedItem[]
}): UseFeedResult => {
	const scrollerRef = useRef<HTMLDivElement>(null)
	const topRef = useRef<HTMLDivElement>(null)
	const bottomRef = useRef<HTMLDivElement>(null)
	const atEnd = useRef(true)
	const opened = useRef(false)
	const anchor = useRef<null | { height: number; top: number }>(null)
	const [unseen, setUnseen] = useState(0)
	/** The newest row the reader has had on screen; only rows after it count as new. */
	const lastId = useRef<null | string>(null)
	const { dividerBefore, hasNewer, hasOlder, loadNewer, loadOlder, markSeen, messages, status } =
		conversation

	const types = useOptionalChatStore()?.meta?.types
	const rows = useMemo(
		() =>
			buildFeedRows({
				dividerBefore,
				isBare: (message) => types?.[message.type]?.layout === 'bare',
				items,
				messages,
			}),
		[dividerBefore, items, messages, types]
	)
	const shownIds = rows.flatMap((row) => (row.kind === 'message' ? [row.key] : []))

	const checkEnd = useCallback(() => {
		const element = scrollerRef.current
		if (!element) return
		atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < END_SLACK_PX
		if (atEnd.current && !hasNewer) {
			setUnseen(0)
			if (document.visibilityState === 'visible') markSeen()
		}
	}, [hasNewer, markSeen])

	// A quick load shows nothing in between; a slow one a skeleton that does not blink.
	const skeleton = useDelayedFlag(status === 'loading' && shownIds.length === 0)

	// First paint of a loaded window: the divider if there is one, else the bottom.
	useLayoutEffect(() => {
		const element = scrollerRef.current
		if (!element || status !== 'ready' || skeleton || opened.current) return
		opened.current = true
		const divider = dividerBefore
			? element.querySelector<HTMLElement>(`[${FEED_DIVIDER_ATTRIBUTE}]`)
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
		const element = scrollerRef.current
		if (!element || !opened.current) return
		if (anchor.current) {
			element.scrollTop = anchor.current.top + (element.scrollHeight - anchor.current.height)
			anchor.current = null
		} else if (atEnd.current && !hasNewer) {
			element.scrollTop = element.scrollHeight
		}
		// Older pages load in above and are not new; count only what arrived below the last row.
		const previous = lastId.current ? shownIds.lastIndexOf(lastId.current) : -1
		const added = previous >= 0 ? shownIds.length - 1 - previous : 0
		if (added > 0 && !atEnd.current) {
			setUnseen((count) => count + added)
		}
		lastId.current = shownIds.at(-1) ?? null
		checkEnd()
	})

	const older = useCallback(async () => {
		const element = scrollerRef.current
		if (!element || !hasOlder) return
		anchor.current = { height: element.scrollHeight, top: element.scrollTop }
		await loadOlder()
	}, [hasOlder, loadOlder])

	useEffect(() => {
		const element = topRef.current
		if (!element || !hasOlder || status !== 'ready') return
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void older()
			},
			{ root: scrollerRef.current, rootMargin: '200px 0px 0px 0px' }
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [hasOlder, older, status])

	useEffect(() => {
		const element = bottomRef.current
		if (!element || !hasNewer || status !== 'ready') return
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadNewer()
			},
			{ root: scrollerRef.current, rootMargin: '0px 0px 200px 0px' }
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [hasNewer, loadNewer, status])

	useEffect(() => {
		const onVisible = () => checkEnd()
		document.addEventListener('visibilitychange', onVisible)
		return () => document.removeEventListener('visibilitychange', onVisible)
	}, [checkEnd])

	const toBottom = async () => {
		if (hasNewer) {
			await conversation.jumpToLatest()
		}
		const element = scrollerRef.current
		if (element) element.scrollTop = element.scrollHeight
		setUnseen(0)
	}

	return {
		bottomRef,
		hasNewer,
		hasOlder,
		loadOlder: older,
		onScroll: checkEnd,
		rows: skeleton ? [] : rows,
		scrollerRef,
		showJump: unseen > 0 || hasNewer,
		skeleton,
		status,
		toBottom,
		topRef,
		unseen,
	}
}
