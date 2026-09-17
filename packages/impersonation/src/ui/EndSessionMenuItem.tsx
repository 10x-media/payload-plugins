'use client'

import {
	ConfirmationModal,
	PopupList,
	toast,
	useConfig,
	useDocumentInfo,
	useModal,
} from '@payloadcms/ui'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { postImpersonation } from './api'
import { useImpersonationClient } from './ImpersonationConfig'

const CONFIRM_SLUG = 'impersonation-confirm-end'

export const EndSessionMenuItem = () => {
	const { id } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const plugin = useImpersonationClient()

	if (!id) {
		return null
	}

	const apiPath = plugin?.apiPath ?? `${config.routes.api}/impersonation`

	const onConfirm = async () => {
		const result = await postImpersonation(`${apiPath}/${encodeURIComponent(String(id))}/end`, {})
		if (!result.ok) {
			toast.error(t(keys.errorForbidden))
			throw new Error('forbidden')
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
				modalSlug={CONFIRM_SLUG}
				onConfirm={onConfirm}
			/>
		</>
	)
}
