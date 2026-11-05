'use client'

import { Button, toast, usePathname } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ImpersonationStatus } from '../getImpersonation'
import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'
import { messageFor } from '../translations/lookup'
import { errorKey, type FailureCode, goAfterSwitch, postImpersonation } from './api'
import { sessionEndsLabel } from './sessionEnds'
import { useImpersonation } from './useImpersonation'
import './impersonation.css'

const SESSION_GONE = new Set([
	'forbidden',
	'impersonatorGone',
	'impersonatorSessionExpired',
	'notImpersonating',
])

export type ImpersonationBarProps = {
	actingAs: string
	adminRoute: string
	apiPath: string
	frontendUrl?: string
	impersonatorLocale?: null | string
	/** Resolved by the provider from the config's translations, so overrides reach the client. */
	messages?: {
		errors: Partial<Record<FailureCode, string>>
	}
	openWebsite: string
	/**
	 * `header`: in the flow of the page, in Payload's `header` slot above the nav and content.
	 * `fixed`: pinned to the bottom, for admin pages without the default template.
	 */
	placement?: 'fixed' | 'header'
	pluginName: string
	returnTo: string
	sessionEndsAt?: null | string
	sessionEndsAtTemplate: string
	sessionEndsInTemplate: string
	showFrontendLink?: boolean
	tone?: 'quiet' | 'warning'
}

/**
 * The admin-wide notice of an impersonation: who you are acting as, when the
 * session ends, and the way back. Re-checks the session on mount, so a bar
 * painted from a stale page goes away by itself.
 */
export const ImpersonationBar = ({
	actingAs,
	adminRoute,
	apiPath,
	frontendUrl,
	impersonatorLocale,
	messages,
	openWebsite,
	placement = 'header',
	pluginName,
	returnTo,
	sessionEndsAt,
	sessionEndsAtTemplate,
	sessionEndsInTemplate,
	showFrontendLink,
	tone = 'warning',
}: ImpersonationBarProps) => {
	const { setStatus } = useImpersonation()
	const pathname = usePathname() ?? ''
	const onLogin = pathname === `${adminRoute}/login`
	const [busy, setBusy] = useState(false)
	const [visible, setVisible] = useState(true)
	const [now, setNow] = useState<null | number>(null)
	const expiredProbe = useRef(false)

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
		if (!sessionEndsAt || !visible || onLogin) {
			return
		}
		expiredProbe.current = false
		setNow(Date.now())
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
				const code = result.error ?? 'failed'
				toast.error(messages?.errors[code] ?? messageFor(impersonatorLocale, errorKey(code)))
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

	if (!visible || onLogin) {
		return null
	}

	const endsLabel = sessionEndsLabel({
		endsAt: sessionEndsAt,
		locale: impersonatorLocale,
		now,
		templates: { endsAt: sessionEndsAtTemplate, endsIn: sessionEndsInTemplate },
	})

	return (
		<div
			aria-live="polite"
			className={[
				'impersonation-bar',
				`impersonation-bar--${placement}`,
				tone === 'quiet' ? 'impersonation-bar--quiet' : null,
			]
				.filter(Boolean)
				.join(' ')}
			role="status"
		>
			<div className="impersonation-bar__row">
				<strong className="impersonation-bar__title">{pluginName}</strong>
				<span>{actingAs}</span>
				{sessionEndsAt ? <span className="impersonation-bar__time">{endsLabel ?? ' '}</span> : null}
				<span className="impersonation-bar__actions">
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
						size="medium"
					>
						{returnTo}
					</Button>
				</span>
			</div>
		</div>
	)
}
