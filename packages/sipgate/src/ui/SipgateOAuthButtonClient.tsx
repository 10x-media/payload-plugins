'use client'

import { Button } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

type Props = {
	connected: boolean
	needsReconnect?: boolean
}

const ERROR_MESSAGES: Record<string, string> = {
	account_already_claimed:
		'This Sipgate account is already linked to another user. Contact your admin or use a different Sipgate account.',
	upsert_failed: 'Could not save your Sipgate connection. Please try again.',
	user_fetch_failed: 'Could not retrieve your Sipgate user profile. Please try again.',
	no_sipgate_user: 'No Sipgate user was found for this account.',
	token_exchange_failed: 'Token exchange with Sipgate failed. Please try again.',
	missing_params: 'OAuth callback was missing required parameters.',
}

export const SipgateOAuthButtonClient = ({ connected, needsReconnect }: Props) => {
	const { t } = useTranslation()
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const errorKey = params.get('sipgate_error')
		if (!errorKey) return

		const claimedBy = params.get('sipgate_claimed_by')
		if (errorKey === 'account_already_claimed' && claimedBy) {
			setErrorMessage(
				`This Sipgate account is already linked to ${decodeURIComponent(claimedBy)}. Contact your admin or use a different Sipgate account.`
			)
		} else {
			setErrorMessage(ERROR_MESSAGES[errorKey] ?? `Connection failed (${errorKey}).`)
		}
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
				url="/api/sipgate/oauth/connect"
				buttonStyle={connected ? 'secondary' : 'primary'}
				margin={false}
			>
				{connected ? t(keys.oauthButtonReconnect) : t(keys.oauthButtonConnect)}
			</Button>
		</div>
	)
}
