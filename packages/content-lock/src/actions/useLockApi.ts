'use client'

import { toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** REST calls on the lock collection, with the admin's session and a toast on failure. */
export const useLockApi = (collectionSlug: string) => {
	const { config } = useConfig()
	const router = useRouter()
	const { t } = useTranslation()
	const [busy, setBusy] = useState(false)
	const base = `${config.serverURL ?? ''}${config.routes.api}/${collectionSlug}`

	const send = useCallback(
		async (path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) => {
			setBusy(true)
			try {
				const response = await fetch(`${base}${path}`, {
					method,
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as {
						errors?: Array<{ message?: string }>
					} | null
					toast.error(payload?.errors?.[0]?.message ?? t(keys.actionFailed))
					return null
				}
				return (await response.json()) as { doc?: { id?: string | number } }
			} catch {
				toast.error(t(keys.actionFailed))
				return null
			} finally {
				setBusy(false)
			}
		},
		[base, t]
	)

	return { busy, router, send }
}
