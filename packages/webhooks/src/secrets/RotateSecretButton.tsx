'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** How long the reveal toast stays up. The secret is never shown again after it closes. */
const REVEAL_TOAST_MS = 60_000

/** Doc-view action that rotates the subscription's signing secret and reveals the new one once. */
export const RotateSecretButton = () => {
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
				`${serverURL}${apiRoute}/${collectionSlug}/${encodeURIComponent(String(id))}/rotate-secret`,
				{ method: 'POST', credentials: 'include' }
			)
			if (!res.ok) {
				throw new Error(String(res.status))
			}
			const { secret } = (await res.json()) as { secret: string }
			await navigator.clipboard?.writeText(secret).catch(() => undefined)
			toast.success(`${t(keys.rotateSecretDone)}: ${secret}`, { duration: REVEAL_TOAST_MS })
		} catch {
			toast.error(t(keys.rotateSecretFailed))
		} finally {
			setBusy(false)
		}
	}

	return (
		<Button buttonStyle="secondary" disabled={busy} onClick={onClick} size="small">
			{t(keys.rotateSecret)}
		</Button>
	)
}
