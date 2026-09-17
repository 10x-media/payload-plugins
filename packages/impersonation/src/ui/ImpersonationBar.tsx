'use client'

import { Button, Pill, toast } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { messageFor } from '../translations/lookup'
import { errorKey, goAfterSwitch, postImpersonation } from './api'
import './impersonation.css'

export type ImpersonationBarProps = {
	actingAs: string
	apiPath: string
	impersonatorLocale?: null | string
	pluginName: string
	returnTo: string
	sessionEndsAt?: null | string
	sessionEndsAtTemplate: string
}

export const ImpersonationBar = ({
	actingAs,
	apiPath,
	impersonatorLocale,
	pluginName,
	returnTo,
	sessionEndsAt,
	sessionEndsAtTemplate,
}: ImpersonationBarProps) => {
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		document.body.classList.add('impersonation--active')
		return () => document.body.classList.remove('impersonation--active')
	}, [])

	const onExit = async () => {
		if (busy) {
			return
		}
		setBusy(true)
		try {
			const result = await postImpersonation(`${apiPath}/exit`, {})
			if (!result.ok) {
				toast.error(messageFor(impersonatorLocale, errorKey(result.error ?? 'failed')))
				if (result.error === 'impersonatorSessionExpired' || result.error === 'impersonatorGone') {
					goAfterSwitch('/admin')
				}
				return
			}
			goAfterSwitch('/admin')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			aria-live="polite"
			className="impersonation-bar"
			data-testid="impersonation-bar"
			role="status"
		>
			<div className="impersonation-bar__meta">
				<div className="impersonation-bar__copy">
					<Pill pillStyle="warning" size="small">
						{pluginName}
					</Pill>
					<span>{actingAs}</span>
				</div>
				{sessionEndsAt ? (
					<div className="impersonation-bar__time">
						{sessionEndsAtTemplate.replace(
							'{{time}}',
							new Date(sessionEndsAt).toLocaleTimeString(impersonatorLocale ?? undefined)
						)}
					</div>
				) : null}
			</div>
			<Button buttonStyle="pill" disabled={busy} onClick={() => void onExit()} size="small">
				{returnTo}
			</Button>
		</div>
	)
}
