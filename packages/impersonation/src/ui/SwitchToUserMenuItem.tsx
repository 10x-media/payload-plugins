'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { errorKey, goAfterSwitch, postImpersonation } from './api'

export const SwitchToUserMenuItem = () => {
	const { collectionSlug, id } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const [busy, setBusy] = useState(false)

	if (!collectionSlug || !id) {
		return null
	}

	const onClick = async () => {
		setBusy(true)
		try {
			const result = await postImpersonation(`${config.routes.api}/impersonation/start`, {
				collection: collectionSlug,
				id,
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

	return (
		<Button buttonStyle="pill" disabled={busy} onClick={() => void onClick()} size="small">
			<span data-testid="impersonation-document-action">{t(keys.switchToUser)}</span>
		</Button>
	)
}
