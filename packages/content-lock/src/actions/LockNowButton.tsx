'use client'

import { Button, ConfirmationModal, useConfig, useModal } from '@payloadcms/ui'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { useLockApi } from './useLockApi'

const MODAL_SLUG = 'content-lock-lock-now'

/**
 * List header action: after a confirmation, starts an unplanned lock over
 * everything that ends manually, and opens it.
 */
export const LockNowButton = ({ collectionSlug }: { collectionSlug: string }) => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { openModal } = useModal()
	const { busy, router, send } = useLockApi(collectionSlug)

	const lockNow = async () => {
		const result = await send('', 'POST', { title: t(keys.actionLockNowTitle) })
		const id = result?.doc?.id
		if (id !== undefined) {
			router.push(`${config.routes.admin}/collections/${collectionSlug}/${id}`)
			router.refresh()
		}
	}

	return (
		<>
			<Button
				buttonStyle="subtle"
				disabled={busy}
				margin={false}
				onClick={() => openModal(MODAL_SLUG)}
				size="small"
			>
				{t(keys.actionLockNow)}
			</Button>
			<ConfirmationModal
				body={t(keys.confirmLockNowBody)}
				confirmLabel={t(keys.actionLockNow)}
				heading={t(keys.confirmLockNowHeading)}
				modalSlug={MODAL_SLUG}
				onConfirm={lockNow}
			/>
		</>
	)
}
