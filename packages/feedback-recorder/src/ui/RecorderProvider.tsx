'use client'

import { Drawer, useAuth, useModal } from '@payloadcms/ui'
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import { createPluginTransport, type SubmissionMeta } from '../client/transport'
import { type ConsoleEntry, startConsoleCapture } from '../context/consoleCapture'
import { collectPageContext, type PageContext } from '../context/pageContext'
import { type BubbleLayout, DEFAULT_BUBBLE } from '../recorder/bubbleLayout'
import { type UseClipRecorderResult, useClipRecorder } from '../recorder/useClipRecorder'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ClientConfig } from '../types'
import { CameraPlacement } from './CameraPlacement'
import { RecorderDrawerBody } from './RecorderDrawerBody'
import { RecordingBar } from './RecordingBar'
import { userKey } from './userKey'
import './feedbackRecorder.css'

export const DRAWER_SLUG = 'feedback-recorder'

export type SubmissionKind = SubmissionMeta['kind']

type RecorderContextValue = {
	recorder: UseClipRecorderResult<SubmissionMeta>
	config: ClientConfig
	elapsedSeconds: number
	kind: SubmissionKind
	setKind: (kind: SubmissionKind) => void
	withCamera: boolean
	setWithCamera: (next: boolean) => void
	open: () => void
	start: () => void
	holdFile: (file: File) => void
	send: (input: { title: string; note: string }) => void
}

const RecorderContext = createContext<RecorderContextValue | null>(null)

/** The recorder, for the header button and the drawer. Null outside the provider (recorder off). */
export const useRecorder = (): RecorderContextValue | null => useContext(RecorderContext)

const LIVE_STATES = new Set(['counting', 'recording', 'paused'])
const SENDING_STATES = new Set(['uploading', 'processing'])

/**
 * Holds the recorder at the root of the admin, so a recording keeps running while the person
 * navigates the CMS to show what they mean. The drawer closes once capture starts, leaving a small
 * bar to pause or stop, and opens again at the review.
 *
 * Context is taken when the recording starts (the page the person was on, the document, the
 * browser), because that is where the thing they want to show us was.
 */
export const RecorderProvider = ({
	children,
	config,
	initiallyAllowed,
	initialUserKey,
}: {
	children?: ReactNode
	config: ClientConfig
	/** The server's answer for the user of the first paint. */
	initiallyAllowed: boolean
	initialUserKey: string | null
}) => {
	const { t } = useTranslation()
	const { user } = useAuth()
	const currentUserKey = userKey(user)
	const [access, setAccess] = useState({ key: initialUserKey, allowed: initiallyAllowed })

	// The root layout this sits in keeps its first render across sign-in and sign-out, so the
	// browser asks again whenever the signed-in user is not the one the server answered for.
	useEffect(() => {
		if (currentUserKey === access.key) return
		if (!currentUserKey) {
			setAccess({ key: null, allowed: false })
			return
		}
		let cancelled = false
		fetch(`${config.endpoint}/access`, { credentials: 'include' })
			.then((response) => (response.ok ? response.json() : { allowed: false }))
			.then((body: { allowed?: unknown }) => {
				if (!cancelled) setAccess({ key: currentUserKey, allowed: body.allowed === true })
			})
			.catch(() => {
				if (!cancelled) setAccess({ key: currentUserKey, allowed: false })
			})
		return () => {
			cancelled = true
		}
	}, [currentUserKey, access.key, config.endpoint])
	const allowed = access.allowed && access.key === currentUserKey
	const { closeModal, openModal } = useModal()
	const [kind, setKind] = useState<SubmissionKind>('bug')
	const [withCamera, setWithCamera] = useState(false)
	const [bubble, setBubble] = useState<BubbleLayout>(DEFAULT_BUBBLE)
	const [elapsedSeconds, setElapsedSeconds] = useState(0)

	const transport = useMemo(() => createPluginTransport(config.endpoint), [config.endpoint])
	const recorder = useClipRecorder({ transport, mode: 'instant', withCamera, bubble })
	const { state } = recorder

	const pageContextRef = useRef<PageContext | null>(null)
	const consoleRef = useRef<{ stop: () => ConsoleEntry[] } | null>(null)
	const consoleEntriesRef = useRef<ConsoleEntry[]>([])

	const open = useCallback(() => openModal(DRAWER_SLUG), [openModal])

	const start = useCallback(() => {
		pageContextRef.current = collectPageContext(config.adminRoute)
		consoleEntriesRef.current = []
		consoleRef.current?.stop()
		consoleRef.current = config.captureConsole ? startConsoleCapture() : null
		setElapsedSeconds(0)
		recorder.start()
	}, [config.adminRoute, config.captureConsole, recorder])

	const holdFile = useCallback(
		(file: File) => {
			pageContextRef.current = collectPageContext(config.adminRoute)
			consoleEntriesRef.current = []
			recorder.holdFile(file)
		},
		[config.adminRoute, recorder]
	)

	const send = useCallback(
		({ title, note }: { title: string; note: string }) => {
			const page = pageContextRef.current ?? collectPageContext(config.adminRoute)
			const consoleErrors = consoleEntriesRef.current
			recorder.send({
				kind,
				title: title.trim() || undefined,
				note: note.trim() || undefined,
				context: {
					...page,
					...(consoleErrors.length > 0 ? { consoleErrors } : {}),
				},
			})
		},
		[config.adminRoute, kind, recorder]
	)

	// Console capture ends with the capture itself, kept for the review and the send.
	useEffect(() => {
		if (LIVE_STATES.has(state) || state === 'requesting' || state === 'placing') return
		if (consoleRef.current) {
			consoleEntriesRef.current = consoleRef.current.stop()
			consoleRef.current = null
		}
	}, [state])

	// The drawer gets out of the way of the recording and comes back for the review.
	const previousState = useRef(state)
	useEffect(() => {
		const before = previousState.current
		previousState.current = state
		if (state === 'recording' && before !== 'paused') closeModal(DRAWER_SLUG)
		if (state === 'review' && LIVE_STATES.has(before)) openModal(DRAWER_SLUG)
		if (state === 'failed' && before !== 'review') openModal(DRAWER_SLUG)
	}, [state, closeModal, openModal])

	useEffect(() => {
		if (state !== 'recording') return
		const timer = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000)
		return () => clearInterval(timer)
	}, [state])

	// Leaving mid-recording or mid-upload loses the take; the browser asks first.
	useEffect(() => {
		if (!LIVE_STATES.has(state) && !SENDING_STATES.has(state)) return
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault()
		}
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [state])

	const value = useMemo<RecorderContextValue>(
		() => ({
			recorder,
			config,
			elapsedSeconds,
			kind,
			setKind,
			withCamera,
			setWithCamera,
			open,
			start,
			holdFile,
			send,
		}),
		[recorder, config, elapsedSeconds, kind, withCamera, open, start, holdFile, send]
	)

	if (!allowed) return children

	return (
		<RecorderContext.Provider value={value}>
			{children}
			<Drawer className="fr-drawer" slug={DRAWER_SLUG} title={t(keys.drawerTitle)}>
				<RecorderDrawerBody />
			</Drawer>
			{recorder.placementStream ? (
				<CameraPlacement
					bubble={bubble}
					labels={{
						heading: t(keys.placeHeading),
						canvas: t(keys.placeCanvas),
						hint: t(keys.placeHint),
						confirm: t(keys.placeConfirm),
						cancel: t(keys.discard),
					}}
					onCancel={recorder.discard}
					onChange={setBubble}
					onConfirm={recorder.confirmPlacement}
					stream={recorder.placementStream}
				/>
			) : null}
			{LIVE_STATES.has(state) ? <RecordingBar /> : null}
		</RecorderContext.Provider>
	)
}
