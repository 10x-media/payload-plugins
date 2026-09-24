'use client'

import { Button, ConfirmationModal, toast, useDocumentInfo, useModal } from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { errorKey } from './api'
import { useImpersonation } from './useImpersonation'

const CONFIRM_SLUG = 'impersonation-confirm-end'

export const EndSessionMenuItem = () => {
	const { collectionSlug, data, id } = useDocumentInfo()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { end, sessionCollection } = useImpersonation()
	const [generation, setGeneration] = useState(0)

	const endedAt =
		data && typeof data === 'object' && 'endedAt' in data
			? (data as { endedAt?: null | string }).endedAt
			: undefined
	if (!id || collectionSlug !== sessionCollection || endedAt) {
		return null
	}

	const onConfirm = async () => {
		const result = await end(id)
		if (!result.ok) {
			toast.error(t(errorKey(result.error ?? 'failed')))
			setGeneration((current) => current + 1)
			throw new Error(result.error ?? 'failed')
		}
		window.location.reload()
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				margin={false}
				onClick={() => openModal(CONFIRM_SLUG)}
				size="small"
			>
				<span data-testid="impersonation-end-session">{t(keys.endSession)}</span>
			</Button>
			<ConfirmationModal
				body={t(keys.endSessionBody)}
				className="impersonation-confirm-modal"
				confirmLabel={t(keys.endSession)}
				heading={t(keys.endSession)}
				key={generation}
				modalSlug={CONFIRM_SLUG}
				onConfirm={onConfirm}
			/>
		</>
	)
}
