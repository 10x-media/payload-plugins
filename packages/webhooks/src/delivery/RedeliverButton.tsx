'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** Doc-view action that POSTs to the deliveries redeliver endpoint. */
export const RedeliverButton = () => {
	const { id, collectionSlug } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const [busy, setBusy] = useState(false)

	if (!id || !collectionSlug) {
		return null
	}

	const apiRoute = config.routes?.api ?? '/api'
	const serverURL = config.serverURL ?? ''

	const onClick = async () => {
		setBusy(true)
		try {
			const res = await fetch(
				`${serverURL}${apiRoute}/${collectionSlug}/${encodeURIComponent(String(id))}/redeliver`,
				{ method: 'POST', credentials: 'include' }
			)
			if (!res.ok) {
				throw new Error(String(res.status))
			}
			toast.success(t(keys.redeliverDone))
		} catch {
			toast.error(t(keys.redeliver))
		} finally {
			setBusy(false)
		}
	}

	return (
		<Button buttonStyle="secondary" disabled={busy} onClick={onClick} size="small">
			{t(keys.redeliver)}
		</Button>
	)
}
