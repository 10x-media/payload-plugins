'use client'

import { PopupList, useConfig, useDocumentInfo, useDocumentTitle, useModal } from '@payloadcms/ui'
import { useMemo } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { useImpersonationClient } from './ImpersonationConfig'
import { StartConfirmModal, type StartTarget } from './StartConfirmModal'

const CONFIRM_SLUG = 'impersonation-confirm-document'

export const SwitchToUserMenuItem = () => {
	const { collectionSlug, data, id } = useDocumentInfo()
	const { title } = useDocumentTitle()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const plugin = useImpersonationClient()
	const apiPath = plugin?.apiPath ?? `${config.routes.api}/impersonation`
	const reasonMode = plugin?.reasonMode ?? 'off'

	const target = useMemo<null | StartTarget>(() => {
		if (!collectionSlug || id === undefined) {
			return null
		}
		const fromData =
			data && typeof data === 'object'
				? String(
						(data as { email?: string; name?: string }).name ??
							(data as { email?: string }).email ??
							''
					)
				: ''
		return {
			collection: collectionSlug,
			id,
			label: fromData || title || String(id),
		}
	}, [collectionSlug, data, id, title])

	if (!target) {
		return null
	}

	return (
		<>
			<PopupList.Button onClick={() => openModal(CONFIRM_SLUG)}>
				<span data-testid="impersonation-document-action">{t(keys.switchToUser)}</span>
			</PopupList.Button>
			<StartConfirmModal
				apiPath={apiPath}
				key={target ? `${target.collection}:${target.id}` : 'idle'}
				modalSlug={CONFIRM_SLUG}
				reasonMode={reasonMode}
				target={target}
			/>
		</>
	)
}
