'use client'

import {
	ConfirmationModal,
	PopupList,
	toast,
	useConfig,
	useDocumentInfo,
	useModal,
} from '@payloadcms/ui'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { errorKey, postImpersonation } from './api'
import { useImpersonationClient } from './ImpersonationConfig'

const CONFIRM_SLUG = 'impersonation-confirm-end'

export const EndSessionMenuItem = () => {
	const { id } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const plugin = useImpersonationClient()
	const [generation, setGeneration] = useState(0)

	if (!id) {
		return null
	}

	const apiPath = plugin?.apiPath ?? `${config.routes.api}/impersonation`

	const onConfirm = async () => {
		const result = await postImpersonation(`${apiPath}/${encodeURIComponent(String(id))}/end`, {})
		if (!result.ok) {
			toast.error(t(errorKey(result.error ?? 'failed')))
			setGeneration((current) => current + 1)
			throw new Error(result.error ?? 'failed')
		}
		window.location.reload()
	}

	return (
		<>
			<PopupList.Button onClick={() => openModal(CONFIRM_SLUG)}>
				<span data-testid="impersonation-end-session">{t(keys.endSession)}</span>
			</PopupList.Button>
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
