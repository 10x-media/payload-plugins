'use client'

import { Button, toast, useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useState } from 'react'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** The help line under the button, tailored to the strategy that closing will apply. */
const hintKeyFor = (type: string | undefined): TranslationKey => {
	if (type === 'mostVoted') {
		return keys.pollCloseHintMostVoted
	}
	if (type === 'source') {
		return keys.pollCloseHintSource
	}
	return keys.pollCloseHintManual
}

/** The server's `{ errors: [{ message }] }` shape, or undefined when the body is not JSON. */
const errorMessageOf = async (response: Response): Promise<string | undefined> => {
	try {
		const body = (await response.json()) as { errors?: { message?: string }[] }
		const message = body?.errors?.[0]?.message
		return typeof message === 'string' && message.length > 0 ? message : undefined
	} catch {
		return undefined
	}
}

/**
 * The `poll.closePoll` UI field: a button that closes a poll with no scheduled `closesAt` on demand,
 * by POSTing to the forms collection's `/:id/close` endpoint with the admin cookie. The endpoint sets
 * `closesAt` to now and, for a `mostVoted`/`source` poll, resolves the winner; the button reads the
 * live `poll.type` to phrase its help line. On success it reloads the document so the closed state and
 * recorded outcome show. Disabled for an unsaved document (no id yet), matching `EndpointOptionsSelect`.
 */
export const ClosePollButton = () => {
	const { t } = useTranslation()
	const { id, collectionSlug } = useDocumentInfo()
	const { config } = useConfig()
	const apiRoute = config.routes.api
	const pollType = useFormFields(([fields]) => {
		const value = fields?.['poll.type']?.value
		return typeof value === 'string' ? value : undefined
	})
	const [submitting, setSubmitting] = useState(false)

	const close = async () => {
		if (id == null || !collectionSlug) {
			return
		}
		setSubmitting(true)
		try {
			const response = await fetch(`${apiRoute}/${collectionSlug}/${id}/close`, {
				method: 'POST',
				credentials: 'include',
				headers: { Accept: 'application/json' },
			})
			if (!response.ok) {
				toast.error((await errorMessageOf(response)) ?? t(keys.pollCloseFailed))
				return
			}
			toast.success(t(keys.pollCloseSuccess))
			window.location.reload()
		} catch {
			toast.error(t(keys.pollCloseFailed))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="field-type" style={{ marginBlockEnd: '1rem' }}>
			<Button buttonStyle="secondary" onClick={close} disabled={id == null || submitting}>
				{t(keys.pollCloseButton)}
			</Button>
			<p className="field-description" style={{ marginBlockStart: '0.5rem' }}>
				{t(hintKeyFor(pollType))}
			</p>
		</div>
	)
}
