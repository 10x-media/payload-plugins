'use client'

import { Button, useDocumentInfo, useDrawerSlug, useModal } from '@payloadcms/ui'

import { toPreviewFile } from '../../shared/types'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { PreviewDrawer } from '../PreviewDrawer/PreviewDrawer'
import { PreviewIcon } from './PreviewIcon'
import './controls.css'

/**
 * Beside the document controls of an upload collection: opens the saved file
 * in a drawer. Renders nothing until the document has a file, and previews the
 * saved file rather than a pending replacement, which has no URL yet.
 */
export const DocumentPreviewButton = () => {
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { collectionSlug, data } = useDocumentInfo()
	const slug = useDrawerSlug('document-preview')
	const file = toPreviewFile(data)

	if (!file) {
		return null
	}
	return (
		<>
			<Button
				buttonStyle="subtle"
				icon={<PreviewIcon />}
				iconPosition="left"
				iconStyle="none"
				margin={false}
				onClick={() => openModal(slug)}
			>
				{t(keys.preview)}
			</Button>
			<PreviewDrawer collection={collectionSlug} doc={data} slug={slug} title={file.filename} />
		</>
	)
}
