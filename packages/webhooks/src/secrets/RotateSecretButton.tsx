'use client'

import { Button, toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'
import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** How long the reveal toast stays up. The secret is never shown again after it closes. */
const REVEAL_TOAST_MS = 60_000

/**
 * Why the rotation was refused, in the caller's terms. A single "could not rotate" hides the
 * difference between a permission problem, a secret the server would not accept, and a concurrent
 * rotation that the operator should simply retry, which are three different next steps.
 */
const FAILURE_BY_STATUS: Record<number, TranslationKey> = {
	400: keys.rotateSecretRejected,
	403: keys.rotateSecretForbidden,
	409: keys.rotateSecretConflict,
}

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
		// Rotation is destructive from the receiver's side: it starts the clock on the secret they
		// are using today, and there is no undo, so a stray click should not begin it.
		if (!window.confirm(t(keys.rotateSecretConfirm))) {
			return
		}
		setBusy(true)
		try {
			const res = await fetch(
				`${serverURL}${apiRoute}/${collectionSlug}/${encodeURIComponent(String(id))}/rotate-secret`,
				{ method: 'POST', credentials: 'include' }
			)
			if (!res.ok) {
				toast.error(t(FAILURE_BY_STATUS[res.status] ?? keys.rotateSecretFailed))
				return
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
