'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { postImpersonation } from './api'

export const EndSessionMenuItem = () => {
	const { id } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const [busy, setBusy] = useState(false)

	if (!id) {
		return null
	}

	const onClick = async () => {
		setBusy(true)
		try {
			const result = await postImpersonation(
				`${config.routes.api}/impersonation/${encodeURIComponent(String(id))}/end`,
				{}
			)
			if (!result.ok) {
				toast.error(t(keys.errorForbidden))
				return
			}
			window.location.reload()
		} finally {
			setBusy(false)
		}
	}

	return (
		<Button buttonStyle="pill" disabled={busy} onClick={() => void onClick()} size="small">
			<span data-testid="impersonation-end-session">{t(keys.endSession)}</span>
		</Button>
	)
}
