'use client'

import { Button, Pill, toast } from '@payloadcms/ui'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { messageFor } from '../translations/lookup'
import { errorKey, goAfterSwitch, postImpersonation } from './api'
import './impersonation.css'

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
	const pathname = useSyncExternalStore(
		subscribeToPath,
		() => window.location.pathname,
		() => adminRoute
	)
	const onLogin = pathname === `${adminRoute}/login` || pathname.endsWith('/login')
	const [busy, setBusy] = useState(false)
	const [visible, setVisible] = useState(!onLogin)
	const [now, setNow] = useState(() => Date.now())
	const rootRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (onLogin) {
			setVisible(false)
			return
		}
		let cancelled = false
		void fetch(apiPath, { credentials: 'include' })
			.then(async (response) => {
				const body = (await response.json().catch(() => ({ active: false }))) as {
					active?: boolean
				}
				if (!cancelled) {
					setVisible(Boolean(body.active))
				}
			})
			.catch(() => {
				if (!cancelled) {
					setVisible(false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [apiPath, onLogin])

	useEffect(() => {
		if (!visible || onLogin) {
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
	}, [onLogin, visible])

	useEffect(() => {
		if (!sessionEndsAt) {
			return
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1000)
		return () => window.clearInterval(timer)
	}, [sessionEndsAt])

	const onExit = async () => {
		if (busy) {
			return
		}
		setBusy(true)
		try {
			const result = await postImpersonation(`${apiPath}/exit`, {})
			if (!result.ok) {
				if (
					result.error === 'notImpersonating' ||
					result.error === 'forbidden' ||
					result.error === 'impersonatorSessionExpired' ||
					result.error === 'impersonatorGone'
				) {
					setVisible(false)
					goAfterSwitch(adminRoute)
					return
				}
				toast.error(messageFor(impersonatorLocale, errorKey(result.error ?? 'failed')))
				return
			}
			goAfterSwitch(adminRoute)
		} finally {
			setBusy(false)
		}
	}

	if (!visible || onLogin) {
		return null
	}

	const countdown = sessionEndsAt ? formatCountdown(sessionEndsAt, now) : null
	const endsLabel = countdown
		? sessionEndsInTemplate.replace('{{countdown}}', countdown)
		: sessionEndsAt
			? sessionEndsAtTemplate.replace(
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
			</div>
		</div>
	)
}
