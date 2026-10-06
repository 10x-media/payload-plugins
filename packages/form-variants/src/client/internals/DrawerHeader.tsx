'use client'

import {
	ConfirmationModal,
	documentDrawerBaseClass,
	Gutter,
	RenderTitle,
	useDocumentInfo,
	useDocumentTitle,
	useFormModified,
	useModal,
	useTranslation,
	XIcon,
} from '@payloadcms/ui'
import { sanitizeID } from '@payloadcms/ui/shared'
import type React from 'react'
import { useCallback } from 'react'

/**
 * The title bar of a document drawer: the document title, the id below it, the consumer's
 * description, and the close button, which asks before discarding unsaved values. It follows
 * Payload's own drawer header, on the same class names, so a variant opened in a drawer looks
 * like any other document.
 *
 * Payload's own `DocumentDrawerHeader` is not exported from `@payloadcms/ui`; see `./index.ts`
 * for why importing it from its subpath is not an option.
 */
const LEAVE_MODAL_SLUG = 'leave-without-saving-doc-drawer'

type Props = {
	AfterHeader?: React.ReactNode
	drawerSlug: string
	showDocumentID?: boolean
}

export const DrawerHeader: React.FC<Props> = ({
	AfterHeader,
	drawerSlug,
	showDocumentID = true,
}) => {
	const { closeModal, openModal } = useModal()
	const { t } = useTranslation()
	const { id } = useDocumentInfo()
	const { title } = useDocumentTitle()
	const modified = useFormModified()

	const close = useCallback(() => {
		if (modified) {
			openModal(LEAVE_MODAL_SLUG)
		} else {
			closeModal(drawerSlug)
		}
	}, [closeModal, drawerSlug, modified, openModal])

	const documentID = showDocumentID && id && id !== title ? String(sanitizeID(id.toString())) : null

	return (
		<Gutter className={`${documentDrawerBaseClass}__header`}>
			<div className={`${documentDrawerBaseClass}__header-content`}>
				<h2 className={`${documentDrawerBaseClass}__header-text`}>
					<RenderTitle element="span" />
				</h2>
				<button
					aria-label={t('general:close')}
					className={`${documentDrawerBaseClass}__header-close`}
					onClick={close}
					type="button"
				>
					<XIcon />
				</button>
			</div>
			{documentID && (
				<div className="id-label" title={documentID}>
					ID:&nbsp;{documentID}
				</div>
			)}
			{AfterHeader && (
				<div className={`${documentDrawerBaseClass}__after-header`}>{AfterHeader}</div>
			)}
			<ConfirmationModal
				body={t('general:changesNotSaved')}
				cancelLabel={t('general:stayOnThisPage')}
				confirmLabel={t('general:leaveAnyway')}
				heading={t('general:leaveWithoutSaving')}
				modalSlug={LEAVE_MODAL_SLUG}
				onConfirm={() => closeModal(drawerSlug)}
			/>
		</Gutter>
	)
}
