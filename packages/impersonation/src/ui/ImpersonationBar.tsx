'use client'

import { Button } from '@payloadcms/ui'
import { useEffect } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { goAfterSwitch, postImpersonation } from './api'
import './impersonation.css'

export type ImpersonationBarProps = {
	apiPath: string
	impersonatorLabel: string
	impersonatorLocale?: null | string
	name: string
	sessionEndsAt?: null | string
}

export const ImpersonationBar = ({
	apiPath,
	impersonatorLabel,
	name,
	sessionEndsAt,
}: ImpersonationBarProps) => {
	const { t } = useTranslation()

	useEffect(() => {
		document.body.classList.add('impersonation--active')
		return () => document.body.classList.remove('impersonation--active')
	}, [])

	const onExit = async () => {
		const result = await postImpersonation(`${apiPath}/exit`, {})
		goAfterSwitch(result.ok ? '/admin' : window.location.pathname)
	}

	return (
		<div
			aria-live="polite"
			className="impersonation-bar"
			data-testid="impersonation-bar"
			role="status"
		>
			<div className="impersonation-bar__meta">
				<div>
					<span className="impersonation-bar__badge">{t(keys.pluginName)}</span>{' '}
					{t(keys.actingAs).replace('{{name}}', name)}
				</div>
				{sessionEndsAt ? (
					<div className="impersonation-bar__time">
						{t(keys.sessionEndsAt).replace(
							'{{time}}',
							new Date(sessionEndsAt).toLocaleTimeString()
						)}
					</div>
				) : null}
			</div>
			<Button buttonStyle="pill" onClick={onExit} size="small">
				{t(keys.returnTo).replace('{{name}}', impersonatorLabel)}
			</Button>
		</div>
	)
}
