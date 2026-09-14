'use client'

import {
	Button,
	useConfig,
	useDocumentInfo,
	useFormModified,
	useFormProcessing,
	useOperation,
} from '@payloadcms/ui'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useWizard } from '../context'

/** What a save does on this collection: Publish, Save draft without publish access, else Save. */
export const useSaveLabel = (): string => {
	const { t } = useTranslation()
	const { collectionSlug, hasPublishPermission } = useDocumentInfo()
	const { getEntityConfig } = useConfig()
	const collectionConfig = getEntityConfig({ collectionSlug })
	if (collectionConfig && hasDraftsEnabled(collectionConfig)) {
		return hasPublishPermission ? t(keys.publish) : t(keys.saveDraft)
	}
	return t(keys.save)
}

/**
 * The top bar's save button, shown on variants that may save on any step (`save: 'always'`).
 * Like Payload's own, it is disabled on an unmodified existing document. Ctrl+S is registered
 * by the runner, so it works whether or not this button is on screen.
 */
export const SaveButton: React.FC = () => {
	const { busy, save, saveAllowed } = useWizard()
	const label = useSaveLabel()
	const modified = useFormModified()
	const processing = useFormProcessing()
	const operation = useOperation()
	const { uploadStatus } = useDocumentInfo()
	const disabled =
		!saveAllowed ||
		busy ||
		processing ||
		uploadStatus === 'uploading' ||
		(operation === 'update' && !modified)

	return (
		<Button
			buttonId="action-save"
			buttonStyle="primary"
			className={`${BASE_CLASS}__save`}
			disabled={disabled}
			onClick={() => void save()}
			size="medium"
			type="button"
		>
			{label}
		</Button>
	)
}
