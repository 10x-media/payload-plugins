'use client'

import { Button, useTranslation as usePayloadTranslation } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'

const useTranslation = () => usePayloadTranslation<Record<string, never>, TranslationKey>()

type Props = {
	connected: boolean
	needsReconnect?: boolean
}

const ERROR_MESSAGES: Record<string, string> = {
	account_already_claimed:
		'This Wildix account is already linked to another user. Contact your admin or use a different Wildix account.',
	upsert_failed: 'Could not save your Wildix connection. Please try again.',
	user_fetch_failed: 'Could not retrieve your Wildix user profile. Please try again.',
	no_wildix_user: 'No Wildix user was found for this account.',
	token_exchange_failed: 'Token exchange with Wildix failed. Please try again.',
	missing_params: 'OAuth callback was missing required parameters.',
	missing_credentials: 'OAuth2 credentials are not configured for this plugin.',
}

export const WildixOAuthButtonClient = ({ connected, needsReconnect }: Props) => {
	const { t } = useTranslation()
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const errorKey = params.get('wildix_error')
		if (!errorKey) return
		setErrorMessage(ERROR_MESSAGES[errorKey] ?? `Connection failed (${errorKey}).`)
	}, [])

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--base) * 0.5)' }}>
			{needsReconnect && (
				<div
					style={{
						padding: 'calc(var(--base) * 0.5) var(--base)',
						background: 'var(--theme-warning-100)',
						color: 'var(--theme-warning-750)',
						borderRadius: 'var(--style-radius-s)',
						fontSize: 'var(--font-size-small)',
						lineHeight: '1.4',
					}}
				>
					{t(keys.oauthTokenExpired)}
				</div>
			)}
			{errorMessage && (
				<div
					style={{
						padding: 'calc(var(--base) * 0.5) var(--base)',
						background: 'var(--theme-error-100)',
						color: 'var(--theme-error-750)',
						borderRadius: 'var(--style-radius-s)',
						fontSize: 'var(--font-size-small)',
						lineHeight: '1.4',
					}}
				>
					{errorMessage}
				</div>
			)}
			<Button
				el="anchor"
				url="/api/wildix/oauth/connect"
				buttonStyle={connected ? 'secondary' : 'primary'}
				margin={false}
			>
				{connected ? t(keys.oauthButtonReconnect) : t(keys.oauthButtonConnect)}
			</Button>
		</div>
	)
}
