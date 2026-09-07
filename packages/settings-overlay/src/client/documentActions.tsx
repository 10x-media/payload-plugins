'use client'

import {
	Popup,
	PopupList,
	useAuth,
	useConfig,
	useDocumentInfo,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { DeleteDocument } from '@payloadcms/ui/elements/DeleteDocument'
import { DuplicateDocument } from '@payloadcms/ui/elements/DuplicateDocument'
import { PermanentlyDeleteButton } from '@payloadcms/ui/elements/PermanentlyDeleteButton'
import { RestoreButton } from '@payloadcms/ui/elements/RestoreButton'
import { useQueryClient } from '@tanstack/react-query'
import type { TypeWithID } from 'payload'
import type React from 'react'
import { useCallback } from 'react'

import { useSettingsOverlayEmbed, useSettingsOverlayOptional } from './context'
import { overlayKeys } from './queries'

const baseClass = 'settings-overlay__doc-actions'

/**
 * Delete, duplicate, restore and "create new" for the document open in the pane, appended to
 * `beforeDocumentControls` of every collection an overlay lists.
 *
 * Payload's own menu cannot be used here. The edit view reads `onDelete`, `onDuplicate`,
 * `onRestore` and `clearDoc` from `DocumentDrawerCallbacksContext`, and `@payloadcms/ui` exports
 * the hook but not the provider, so inside the pane those callbacks are all `undefined` and every
 * action either navigates the admin away or silently does nothing. `renderDocumentArgs` therefore
 * sets `disableActions`, which hides that menu.
 *
 * The way back in is the direction the callbacks travel. Context flows from the pane into the
 * rendered document, so rather than reading Payload's context this renders Payload's own action
 * components with `redirectAfterX={false}` and `onX` bound to the panel. The logic of every
 * action stays Payload's, including the trash-versus-permanent-delete branch and its confirmation
 * copy; only the menu chrome is the plugin's.
 *
 * Two consequences of `disableActions` that Payload does not gate are handled here rather than
 * left broken. `PermanentlyDeleteButton` and `RestoreButton` render in the controls row outside
 * the menu gate, and `render-document` never forwards `redirectAfterRestore`
 * (`handleServerFunction.tsx` destructures only create, delete and duplicate), so Payload's own
 * restore button would push the whole admin to the collection route. Both are replaced here and
 * the originals are hidden in `styles.css`.
 *
 * Harmless on a normal page: with no panel open, or for a nested drawer opened from inside one,
 * it renders nothing.
 */
export const SettingsOverlayDocumentActions: React.FC = () => {
	const embed = useSettingsOverlayEmbed()
	const overlay = useSettingsOverlayOptional()
	const queryClient = useQueryClient()
	const { permissions } = useAuth()
	const { config, getEntityConfig } = useConfig()
	const { i18n } = usePayloadTranslation()
	const { collectionSlug, hasDeletePermission, hasSavePermission, id, isTrashed } =
		useDocumentInfo()

	const docID = embed?.docID
	const itemSlug = embed?.itemSlug
	const setFormModified = overlay?.setFormModified
	const setTarget = embed?.setTarget

	// The pane's own document, and only that one. A document drawer opened from inside the pane
	// carries this component too, and its actions belong to the drawer rather than to the panel.
	const isPaneDocument = Boolean(
		embed?.itemType === 'collection' && collectionSlug === itemSlug && id && String(id) === docID
	)

	const invalidateLists = useCallback(() => {
		if (collectionSlug) {
			void queryClient.invalidateQueries({ queryKey: overlayKeys.lists(collectionSlug) })
		}
	}, [collectionSlug, queryClient])

	const onDelete = useCallback(() => {
		if (collectionSlug) {
			queryClient.removeQueries({
				queryKey: overlayKeys.document('collection', collectionSlug, docID),
			})
		}
		invalidateLists()
		setFormModified?.(false)
		if (itemSlug) {
			setTarget?.({ item: itemSlug })
		}
	}, [collectionSlug, docID, invalidateLists, itemSlug, queryClient, setFormModified, setTarget])

	const onDuplicate = useCallback(
		({ doc }: { doc: TypeWithID }) => {
			invalidateLists()
			if (itemSlug) {
				setTarget?.({ id: String(doc.id), item: itemSlug })
			}
		},
		[invalidateLists, itemSlug, setTarget]
	)

	// Restoring leaves the pane on the same document, whose render still shows the trashed state.
	const onRestore = useCallback(() => {
		invalidateLists()
		if (collectionSlug) {
			void queryClient.invalidateQueries({
				queryKey: overlayKeys.document('collection', collectionSlug, docID),
			})
		}
	}, [collectionSlug, docID, invalidateLists, queryClient])

	const onCreateNew = useCallback(() => {
		if (itemSlug) {
			setTarget?.({ id: 'new', item: itemSlug })
		}
	}, [itemSlug, setTarget])

	if (!isPaneDocument || !collectionSlug || !id) {
		return null
	}

	const collectionConfig = getEntityConfig({ collectionSlug })
	const singularLabel = collectionConfig?.labels?.singular
	const canCreate = permissions?.collections?.[collectionSlug]?.create === true
	const canDelete = Boolean(hasDeletePermission) && !isTrashed
	const canDuplicate = canCreate && collectionConfig?.disableDuplicate !== true && !isTrashed
	const showCreate = canCreate && !isTrashed

	return (
		<div className={baseClass}>
			{isTrashed && hasDeletePermission ? (
				<PermanentlyDeleteButton
					buttonId="settings-overlay-permanently-delete"
					collectionSlug={collectionSlug}
					id={String(id)}
					onDelete={onDelete}
					redirectAfterDelete={false}
					singularLabel={singularLabel}
				/>
			) : null}
			{isTrashed && hasSavePermission ? (
				<RestoreButton
					buttonId="settings-overlay-restore"
					collectionSlug={collectionSlug}
					id={String(id)}
					onRestore={onRestore}
					redirectAfterRestore={false}
					singularLabel={singularLabel}
				/>
			) : null}
			{showCreate || canDuplicate || canDelete ? (
				<Popup
					button={
						<div className="doc-controls__dots">
							<div />
							<div />
							<div />
						</div>
					}
					className="doc-controls__popup"
					horizontalAlign="right"
					size="large"
					verticalAlign="bottom"
				>
					<PopupList.ButtonGroup>
						{showCreate ? (
							<PopupList.Button id="settings-overlay-create" onClick={onCreateNew}>
								{i18n.t('general:createNew')}
							</PopupList.Button>
						) : null}
						{canDuplicate ? (
							<DuplicateDocument
								id={id}
								onDuplicate={onDuplicate}
								redirectAfterDuplicate={false}
								singularLabel={singularLabel}
								slug={collectionSlug}
							/>
						) : null}
						{canDuplicate && config.localization ? (
							<DuplicateDocument
								id={id}
								onDuplicate={onDuplicate}
								redirectAfterDuplicate={false}
								selectLocales={true}
								singularLabel={singularLabel}
								slug={collectionSlug}
							/>
						) : null}
						{canDelete ? (
							<DeleteDocument
								buttonId="settings-overlay-delete"
								collectionSlug={collectionSlug}
								id={String(id)}
								onDelete={onDelete}
								redirectAfterDelete={false}
								singularLabel={singularLabel}
								useAsTitle={collectionConfig?.admin?.useAsTitle}
							/>
						) : null}
					</PopupList.ButtonGroup>
				</Popup>
			) : null}
		</div>
	)
}
