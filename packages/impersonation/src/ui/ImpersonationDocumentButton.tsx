'use client'

import { Button, useDocumentInfo, useDocumentTitle, useModal } from '@payloadcms/ui'
import { useMemo } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ImpersonateIcon } from './ImpersonateIcon'
import { StartConfirmModal, type StartTarget } from './StartConfirmModal'
import { useImpersonation } from './useImpersonation'

const CONFIRM_SLUG = 'impersonation-confirm-document'

export const ImpersonationDocumentButton = () => {
	const { collectionSlug, data, id } = useDocumentInfo()
	const { title } = useDocumentTitle()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { apiPath, reasonMode, targets } = useImpersonation()

	const target = useMemo<null | StartTarget>(() => {
		if (!collectionSlug || id === undefined || targets[collectionSlug] === undefined) {
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
	}, [collectionSlug, data, id, targets, title])

	if (!target) {
		return null
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				className="impersonation-document-button"
				margin={false}
				onClick={() => openModal(CONFIRM_SLUG)}
				size="small"
			>
				<span className="impersonation-header-action">
					<ImpersonateIcon />
					<span data-testid="impersonation-document-action">{t(keys.switchToUser)}</span>
				</span>
			</Button>
			<StartConfirmModal
				apiPath={apiPath}
				key={`${target.collection}:${target.id}`}
				modalSlug={CONFIRM_SLUG}
				reasonMode={reasonMode}
				target={target}
			/>
		</>
	)
}
