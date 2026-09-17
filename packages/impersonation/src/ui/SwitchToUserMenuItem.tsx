'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { errorKey, goAfterSwitch, postImpersonation } from './api'
import { useImpersonationClient } from './ImpersonationConfig'
import './impersonation.css'

export const SwitchToUserMenuItem = () => {
	const { collectionSlug, id } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const plugin = useImpersonationClient()
	const [busy, setBusy] = useState(false)
	const [reasonOpen, setReasonOpen] = useState(false)
	const [reason, setReason] = useState('')

	if (!collectionSlug || !id) {
		return null
	}

	const apiPath = plugin?.apiPath ?? `${config.routes.api}/impersonation`
	const reasonMode = plugin?.reasonMode ?? 'off'

	const start = async (nextReason?: string) => {
		setBusy(true)
		try {
			const result = await postImpersonation(`${apiPath}/start`, {
				collection: collectionSlug,
				id,
				reason: reasonMode === 'off' ? undefined : nextReason,
			})
			if (!result.ok) {
				toast.error(t(errorKey(result.error ?? 'failed')))
				return
			}
			goAfterSwitch(result.redirect)
		} finally {
			setBusy(false)
		}
	}

	const onClick = () => {
		if (reasonMode === 'required') {
			setReasonOpen(true)
			return
		}
		void start(reasonMode === 'optional' ? reason : undefined)
	}

	return (
		<>
			<Button buttonStyle="pill" disabled={busy} onClick={onClick} size="small">
				<span data-testid="impersonation-document-action">{t(keys.switchToUser)}</span>
			</Button>
			{reasonOpen ? (
				<div className="impersonation-overlay">
					<div className="impersonation-dialog" role="dialog">
						<h2>{t(keys.confirmTitle)}</h2>
						<label>
							{t(keys.reasonLabel)}
							<input
								onChange={(event) => setReason(event.target.value)}
								placeholder={t(keys.reasonPlaceholder)}
								value={reason}
							/>
						</label>
						<div className="impersonation-dialog__actions">
							<Button buttonStyle="secondary" disabled={busy} onClick={() => setReasonOpen(false)}>
								{t(keys.cancel)}
							</Button>
							<Button disabled={busy || !reason.trim()} onClick={() => void start(reason)}>
								<span data-testid="impersonation-confirm">{t(keys.confirm)}</span>
							</Button>
						</div>
					</div>
				</div>
			) : null}
		</>
	)
}
