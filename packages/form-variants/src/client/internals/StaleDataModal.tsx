'use client'

import { Button, Modal, useModal, useRouteCache, useTranslation } from '@payloadcms/ui'
import type React from 'react'
import { useEffect } from 'react'

/**
 * Shown when the server reports that the document changed underneath the open form: reloading
 * is the only way out, as on the native form. Payload's own `DocumentStaleData` is not
 * exported from `@payloadcms/ui`; see `./index.ts` for why importing it from its subpath is
 * not an option.
 */
const MODAL_SLUG = 'document-stale-data'
const BASE_CLASS = 'document-stale-data'

type Props = {
	isActive: boolean
	onReload: () => Promise<void> | void
}

export const StaleDataModal: React.FC<Props> = ({ isActive, onReload }) => {
	const { closeModal, openModal } = useModal()
	const { clearRouteCache } = useRouteCache()
	const { t } = useTranslation()

	useEffect(() => {
		if (isActive) {
			openModal(MODAL_SLUG)
		} else {
			closeModal(MODAL_SLUG)
		}
	}, [closeModal, isActive, openModal])

	const reload = async (): Promise<void> => {
		closeModal(MODAL_SLUG)
		clearRouteCache()
		await onReload()
	}

	return (
		<Modal className={BASE_CLASS} closeOnBlur={false} slug={MODAL_SLUG}>
			<div className={`${BASE_CLASS}__wrapper`}>
				<div className={`${BASE_CLASS}__content`}>
					<h1>{t('general:documentModified')}</h1>
					<p>{t('general:documentOutOfDate')}</p>
				</div>
				<div className={`${BASE_CLASS}__controls`}>
					<Button
						buttonStyle="primary"
						id={`${MODAL_SLUG}-reload`}
						margin={false}
						onClick={() => void reload()}
						size="medium"
					>
						{t('general:reloadDocument')}
					</Button>
				</div>
			</div>
		</Modal>
	)
}
