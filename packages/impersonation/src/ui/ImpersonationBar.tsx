'use client'

import { Button, Pill, toast } from '@payloadcms/ui'
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'

import type { ImpersonationStatus } from '../getImpersonation'
import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'
import { keys } from '../translations/keys'
import { fillTemplate, messageFor } from '../translations/lookup'
import { errorKey, goAfterSwitch, postImpersonation } from './api'
import {
	anchorsFor,
	type BarEdge,
	type BarInset,
	measureNavInset,
	nearestEdge,
	type Point,
	projectThrow,
	readBarPlacement,
	writeBarPlacement,
} from './barPlacement'
import { useImpersonation } from './useImpersonation'
import './impersonation.css'

const SESSION_GONE = new Set([
	'forbidden',
	'impersonatorGone',
	'impersonatorSessionExpired',
	'notImpersonating',
])

const subscribeToPath = (onChange: () => void): (() => void) => {
	window.addEventListener('popstate', onChange)
	const push = history.pushState.bind(history)
	const replace = history.replaceState.bind(history)
	history.pushState = (...args) => {
		push(...args)
		onChange()
	}
	history.replaceState = (...args) => {
		replace(...args)
		onChange()
	}
	return () => {
		window.removeEventListener('popstate', onChange)
		history.pushState = push
		history.replaceState = replace
	}
}

const formatCountdown = (expiresAt: string, now: number): string | null => {
	const remaining = new Date(expiresAt).getTime() - now
	if (!Number.isFinite(remaining) || remaining <= 0) {
		return '0s'
	}
	const totalSeconds = Math.floor(remaining / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
	}
	if (minutes > 0) {
		return `${minutes}m ${String(seconds).padStart(2, '0')}s`
	}
	return `${seconds}s`
}

export type ImpersonationBarProps = {
	actingAs: string
	adminRoute: string
	apiPath: string
	frontendUrl?: string
	impersonatorLocale?: null | string
	openWebsite: string
	pluginName: string
	returnTo: string
	sessionEndsAt?: null | string
	sessionEndsAtTemplate: string
	sessionEndsInTemplate: string
	showFrontendLink?: boolean
}

export const ImpersonationBar = ({
	actingAs,
	adminRoute,
	apiPath,
	frontendUrl,
	impersonatorLocale,
	openWebsite,
	pluginName,
	returnTo,
	sessionEndsAt,
	sessionEndsAtTemplate,
	sessionEndsInTemplate,
	showFrontendLink,
}: ImpersonationBarProps) => {
	const { setStatus } = useImpersonation()
	const [mounted, setMounted] = useState(false)
	const pathname = useSyncExternalStore(
		subscribeToPath,
		() => window.location.pathname,
		() => ''
	)
	const onLogin = mounted && pathname === `${adminRoute}/login`
	const [busy, setBusy] = useState(false)
	const [visible, setVisible] = useState(true)
	const [collapsed, setCollapsed] = useState(false)
	const [edge, setEdge] = useState<BarEdge>('right')
	const [inset, setInset] = useState<BarInset>({ end: 0, start: 0 })
	const [dragPoint, setDragPoint] = useState<null | Point>(null)
	const [now, setNow] = useState(() => Date.now())
	const rootRef = useRef<HTMLDivElement>(null)
	const chipRef = useRef<HTMLDivElement>(null)
	const expiredProbe = useRef(false)
	const dragOffset = useRef<null | Point>(null)
	const dragPointRef = useRef<null | Point>(null)
	const dragOrigin = useRef<null | Point>(null)
	const dragged = useRef(false)
	const lastSample = useRef<null | { t: number; x: number; y: number }>(null)
	const velocity = useRef<Point>({ x: 0, y: 0 })
	const endChipDragRef = useRef<() => void>(() => {})
	const onWindowPointerEnd = useRef(() => {
		endChipDragRef.current()
	})
	const docked = visible && !onLogin && !collapsed

	useEffect(() => {
		const stored = readBarPlacement()
		setCollapsed(stored.collapsed)
		setEdge(stored.edge)
		setMounted(true)
	}, [])

	useEffect(() => {
		if (!visible || onLogin) {
			return
		}
		const measure = () => setInset(measureNavInset())
		measure()
		const resize = new ResizeObserver(measure)
		const wrap = document.querySelector('.template-default__wrap')
		const nav = document.querySelector('aside.nav')
		if (wrap) {
			resize.observe(wrap)
		}
		if (nav) {
			resize.observe(nav)
		}
		window.addEventListener('resize', measure)
		return () => {
			resize.disconnect()
			window.removeEventListener('resize', measure)
		}
	}, [onLogin, visible])

	const probe = useCallback(async () => {
		try {
			const response = await fetch(apiPath, {
				credentials: 'include',
				signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
			})
			const body = (await response.json()) as { active?: boolean }
			if (typeof body.active !== 'boolean') {
				return
			}
			setStatus(body.active ? (body as ImpersonationStatus) : { active: false })
			setVisible(body.active)
		} catch {
			// A timeout or a non-JSON body leaves the painted bar in place.
		}
	}, [apiPath, setStatus])

	useEffect(() => {
		if (onLogin) {
			setVisible(false)
			return
		}
		void probe()
	}, [onLogin, probe])

	useEffect(() => {
		document.documentElement.style.setProperty('--impersonation-inline-start', `${inset.start}px`)
		document.documentElement.style.setProperty('--impersonation-inline-end', `${inset.end}px`)
	}, [inset.end, inset.start])

	useEffect(() => {
		if (!docked) {
			document.body.classList.remove('impersonation--active')
			document.documentElement.style.removeProperty('--impersonation-bar-height')
			return
		}
		document.body.classList.add('impersonation--active')
		const node = rootRef.current
		const applyHeight = () => {
			if (!node) {
				return
			}
			document.documentElement.style.setProperty(
				'--impersonation-bar-height',
				`${node.offsetHeight}px`
			)
		}
		applyHeight()
		if (!node) {
			return () => {
				document.body.classList.remove('impersonation--active')
				document.documentElement.style.removeProperty('--impersonation-bar-height')
			}
		}
		const observer = new ResizeObserver(applyHeight)
		observer.observe(node)
		return () => {
			document.body.classList.remove('impersonation--active')
			document.documentElement.style.removeProperty('--impersonation-bar-height')
			observer.disconnect()
		}
	}, [docked])

	useEffect(() => {
		if (!sessionEndsAt || !visible || onLogin) {
			return
		}
		expiredProbe.current = false
		const timer = window.setInterval(() => {
			const next = Date.now()
			setNow(next)
			if (expiredProbe.current) {
				return
			}
			if (new Date(sessionEndsAt).getTime() - next <= 0) {
				expiredProbe.current = true
				void probe()
			}
		}, 1000)
		return () => window.clearInterval(timer)
	}, [onLogin, probe, sessionEndsAt, visible])

	const onExit = async () => {
		if (busy) {
			return
		}
		setBusy(true)
		try {
			const result = await postImpersonation(`${apiPath}/exit`, {})
			if (!result.ok) {
				toast.error(messageFor(impersonatorLocale, errorKey(result.error ?? 'failed')))
				if (result.error && SESSION_GONE.has(result.error)) {
					setStatus({ active: false })
					setVisible(false)
					goAfterSwitch(adminRoute)
				}
				return
			}
			goAfterSwitch(adminRoute)
		} finally {
			setBusy(false)
		}
	}

	const collapse = () => {
		const next = { collapsed: true, edge }
		setCollapsed(true)
		writeBarPlacement(next)
	}

	const expand = () => {
		const next = { collapsed: false, edge }
		setCollapsed(false)
		setDragPoint(null)
		writeBarPlacement(next)
	}

	const endChipDrag = () => {
		if (!dragOffset.current && !dragOrigin.current) {
			return
		}
		window.removeEventListener('pointerup', onWindowPointerEnd.current)
		window.removeEventListener('pointercancel', onWindowPointerEnd.current)
		const point = dragPointRef.current
		const didDrag = dragged.current
		dragOffset.current = null
		dragOrigin.current = null
		dragPointRef.current = null
		if (!didDrag) {
			expand()
			return
		}
		const rect = chipRef.current?.getBoundingClientRect()
		if (!point || !rect) {
			setDragPoint(null)
			return
		}
		const header = Number.parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')
		)
		const anchors = anchorsFor({
			header: Number.isFinite(header) ? header : 48,
			inset: { end: 0, start: 0 },
			size: { height: rect.height, width: rect.width },
			viewport: { height: window.innerHeight, width: window.innerWidth },
		})
		const nextEdge = nearestEdge(projectThrow(point, velocity.current), anchors)
		setEdge(nextEdge)
		setDragPoint(null)
		writeBarPlacement({ collapsed: true, edge: nextEdge })
	}
	endChipDragRef.current = endChipDrag

	const onChipPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return
		}
		const rect = chipRef.current?.getBoundingClientRect()
		if (!rect) {
			return
		}
		dragged.current = false
		dragOrigin.current = { x: event.clientX, y: event.clientY }
		dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
		lastSample.current = { t: event.timeStamp, x: event.clientX, y: event.clientY }
		velocity.current = { x: 0, y: 0 }
		window.addEventListener('pointerup', onWindowPointerEnd.current)
		window.addEventListener('pointercancel', onWindowPointerEnd.current)
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	const onChipPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragOffset.current || !dragOrigin.current) {
			return
		}
		if (event.pointerType !== 'touch' && event.buttons === 0) {
			endChipDrag()
			return
		}
		const travel = Math.hypot(
			event.clientX - dragOrigin.current.x,
			event.clientY - dragOrigin.current.y
		)
		if (!dragged.current && travel < 4) {
			return
		}
		dragged.current = true
		const next = {
			x: event.clientX - dragOffset.current.x,
			y: event.clientY - dragOffset.current.y,
		}
		const previous = lastSample.current
		const dt = previous ? event.timeStamp - previous.t : 0
		if (previous && dt > 0) {
			velocity.current = {
				x: (event.clientX - previous.x) / dt,
				y: (event.clientY - previous.y) / dt,
			}
		}
		lastSample.current = { t: event.timeStamp, x: event.clientX, y: event.clientY }
		dragPointRef.current = next
		setDragPoint(next)
	}

	if (!visible || onLogin) {
		return null
	}

	if (collapsed) {
		const rect = chipRef.current?.getBoundingClientRect()
		const header = mounted
			? Number.parseFloat(
					getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')
				)
			: 48
		const anchors = anchorsFor({
			header: Number.isFinite(header) ? header : 48,
			inset: { end: 0, start: 0 },
			size: { height: rect?.height ?? 36, width: rect?.width ?? 168 },
			viewport: {
				height: mounted ? window.innerHeight : 800,
				width: mounted ? window.innerWidth : 1200,
			},
		})
		const point = dragPoint ?? anchors[edge]
		return (
			<div
				aria-live="polite"
				className={
					dragPoint ? 'impersonation-chip impersonation-chip--dragging' : 'impersonation-chip'
				}
				data-testid="impersonation-bar-chip"
				onPointerCancel={endChipDrag}
				onPointerDown={onChipPointerDown}
				onPointerMove={onChipPointerMove}
				onPointerUp={endChipDrag}
				ref={chipRef}
				role="status"
				style={{ left: point.x, top: point.y }}
			>
				<span>{pluginName}</span>
				<button
					aria-label={messageFor(impersonatorLocale, keys.expandBar)}
					className="impersonation-bar__icon"
					onClick={(event) => {
						if (dragged.current) {
							event.preventDefault()
							return
						}
						expand()
					}}
					type="button"
				>
					<ExpandIcon />
				</button>
			</div>
		)
	}

	const countdown = sessionEndsAt ? formatCountdown(sessionEndsAt, now) : null
	const endsLabel =
		countdown && countdown !== '0s'
			? fillTemplate(sessionEndsInTemplate, '{{countdown}}', countdown)
			: sessionEndsAt && countdown !== '0s'
				? fillTemplate(
						sessionEndsAtTemplate,
						'{{time}}',
						new Date(sessionEndsAt).toLocaleTimeString(impersonatorLocale ?? undefined)
					)
				: null

	return (
		<div
			aria-live="polite"
			className="impersonation-bar"
			data-testid="impersonation-bar"
			ref={rootRef}
			role="status"
		>
			<div className="impersonation-bar__meta">
				<div className="impersonation-bar__copy">
					<Pill pillStyle="warning" size="small">
						{pluginName}
					</Pill>
					<span>{actingAs}</span>
				</div>
				{endsLabel ? <div className="impersonation-bar__time">{endsLabel}</div> : null}
			</div>
			<div className="impersonation-bar__actions">
				{showFrontendLink && frontendUrl ? (
					<a className="impersonation-bar__link" href={frontendUrl}>
						{openWebsite}
					</a>
				) : null}
				<Button
					buttonStyle="pill"
					disabled={busy}
					margin={false}
					onClick={() => void onExit()}
					size="small"
				>
					{returnTo}
				</Button>
				<button
					aria-label={messageFor(impersonatorLocale, keys.collapseBar)}
					className="impersonation-bar__icon"
					onClick={collapse}
					type="button"
				>
					<CollapseIcon />
				</button>
			</div>
		</div>
	)
}

const CollapseIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" />
	</svg>
)

const ExpandIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path d="M3 6h10M3 10h10" stroke="currentColor" strokeWidth="1.5" />
	</svg>
)
