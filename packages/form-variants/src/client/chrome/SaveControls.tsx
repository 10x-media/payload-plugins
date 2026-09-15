'use client'

import {
	FormSubmit,
	useConfig,
	useDocumentInfo,
	useFormModified,
	useOperation,
	useTranslation,
} from '@payloadcms/ui'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'

import { useWizard } from '../context'

/** Whether the collection keeps drafts, which is what puts a draft save beside the publish. */
const useDrafts = (): boolean => {
	const { collectionSlug } = useDocumentInfo()
	const { getEntityConfig } = useConfig()
	const collectionConfig = getEntityConfig({ collectionSlug })
	return collectionConfig ? hasDraftsEnabled(collectionConfig) : false
}

/**
 * Payload's rule for its own Save and Save draft, which is that an existing document nobody has
 * touched has nothing to write, with the variant's save guard on top of it.
 */
const useCanSave = (): boolean => {
	const { busy, saveAllowed } = useWizard()
	const { uploadStatus } = useDocumentInfo()
	const modified = useFormModified()
	const operation = useOperation()
	return (
		saveAllowed && !busy && uploadStatus !== 'uploading' && (modified || operation === 'create')
	)
}

/** The save on a collection without drafts. Payload's `SaveButton`, through the guard. */
const Save: React.FC = () => {
	const { t } = useTranslation()
	const { save } = useWizard()
	const canSave = useCanSave()

	return (
		<FormSubmit
			buttonId="action-save"
			disabled={!canSave}
			onClick={() => void save()}
			size="medium"
			type="button"
		>
			{t('general:save')}
		</FormSubmit>
	)
}

/** Payload's `SaveDraftButton`, through the guard. */
const SaveDraft: React.FC = () => {
	const { t } = useTranslation()
	const { save } = useWizard()
	const canSave = useCanSave()

	return (
		<FormSubmit
			buttonId="action-save-draft"
			buttonStyle="secondary"
			className="save-draft"
			disabled={!canSave}
			onClick={() => void save({ draft: true })}
			size="medium"
			type="button"
		>
			{t('version:saveDraft')}
		</FormSubmit>
	)
}

/**
 * Payload's `PublishButton`, through the guard. It answers to more than the form being
 * modified: a draft saved a moment ago is an unpublished version, and a document that was
 * never published has something to publish whatever its form says. Scheduling and per-locale
 * publishing are document controls and stay on the native form.
 */
const Publish: React.FC = () => {
	const { t } = useTranslation()
	const { busy, save, saveAllowed } = useWizard()
	const { hasPublishedDoc, unpublishedVersionCount, uploadStatus } = useDocumentInfo()
	const modified = useFormModified()
	const canPublish =
		saveAllowed &&
		!busy &&
		uploadStatus !== 'uploading' &&
		(modified || unpublishedVersionCount > 0 || !hasPublishedDoc)

	return (
		<FormSubmit
			buttonId="action-save"
			disabled={!canPublish}
			onClick={() => void save()}
			size="medium"
			type="button"
		>
			{t('version:publishChanges')}
		</FormSubmit>
	)
}

/**
 * The variant's save controls: the same buttons Payload's own document bar carries, under the
 * same rules and with the same labels, plus the save guard. They render wherever the variant
 * saves, which is the top bar under `save: 'always'` and the last step under `save: 'final-step'`.
 *
 * Payload drops Save draft when autosave writes the drafts instead. A variant form never
 * autosaves, so it stays: without it an autosave collection could only ever be published here.
 */
export const SaveControls: React.FC = () => {
	const { hasPublishPermission } = useDocumentInfo()
	const drafts = useDrafts()

	if (!drafts) {
		return <Save />
	}

	return (
		<>
			<SaveDraft />
			{hasPublishPermission && <Publish />}
		</>
	)
}
