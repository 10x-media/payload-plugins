'use client'

import { getTranslation, type TFunction } from '@payloadcms/translations'
import {
	Button,
	CheckboxInput,
	ConfirmationModal,
	Popup,
	PopupList,
	Translation,
	toast,
	useAuth,
	useConfig,
	useDocumentInfo,
	useDocumentTitle,
	useForm,
	useModal,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { useQueryClient } from '@tanstack/react-query'
import { formatAdminURL, hasDraftsEnabled } from 'payload/shared'
import type React from 'react'
import { Fragment, useCallback, useState } from 'react'

import { useSettingsOverlayEmbed, useSettingsOverlayOptional } from './context'
import { overlayKeys } from './queries'

const baseClass = 'settings-overlay__doc-actions'

/**
 * The one trashed document, in the shape `qs.stringify` produces for Payload's collection
 * endpoints. A trashed document is invisible to the by-id routes, so restore and permanent delete
 * go through the collection with a `where` instead.
 */
const trashedDocQuery = (docID: string): string =>
	`?trash=true&where[and][0][id][equals]=${encodeURIComponent(docID)}` +
	'&where[and][1][deletedAt][exists]=true'

/**
 * WORKAROUND. Delete, duplicate, restore and "create new" for the document open in the pane,
 * appended to `beforeDocumentControls` of every collection an overlay lists.
 *
 * What is being worked around: the edit view reads `onDelete`, `onDuplicate`, `onRestore` and
 * `clearDoc` from `DocumentDrawerCallbacksContext`, and `@payloadcms/ui` exports the hook but not
 * the provider. Inside the pane those callbacks are all `undefined`, so Payload's own menu either
 * navigates the whole admin away or silently does nothing, and `renderDocumentArgs` hides it with
 * `disableActions`.
 *
 * Why the actions are rewritten rather than borrowed: `DeleteDocument`, `DuplicateDocument`,
 * `RestoreButton` and `PermanentlyDeleteButton` do take the callbacks as plain props, and they are
 * reachable at `@payloadcms/ui/elements/*`. They still cannot be used. `@payloadcms/ui` ships the
 * same code twice: `exports/client` is a bundled artifact carrying its own copy of every provider,
 * while `dist/elements/*` are unbundled modules importing `dist/providers/*` directly. The admin
 * mounts the bundled copy, so a component reached by subpath reads a second, never-provided
 * `RootConfigContext` and throws on its first hook. Every request below therefore mirrors the
 * matching Payload component, including the trash-versus-permanent-delete branch, and the copy
 * comes from Payload's own `general:` keys so the panel and the page cannot disagree.
 *
 * Not carried over: duplicating into selected locales, whose drawer has no barrel export.
 *
 * What replaces this: `DocumentDrawerContextProvider` becoming public. The canary in
 * `tests/int/payloadCanaries.int.spec.ts` fails when it does, and then this file and the
 * `disableActions` flag in `queries.ts` both go.
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
	const { openModal } = useModal()
	const { setModified } = useForm()
	const { title } = useDocumentTitle()
	const { i18n, t } = usePayloadTranslation()
	const {
		collectionSlug,
		hasDeletePermission,
		hasSavePermission,
		hasTrashPermission,
		id,
		isTrashed,
	} = useDocumentInfo()

	const [deletePermanently, setDeletePermanently] = useState(false)
	const [restoreAsPublished, setRestoreAsPublished] = useState(false)

	const apiRoute = config.routes.api
	const docID = id ? String(id) : undefined
	const itemSlug = embed?.itemSlug
	const setFormModified = overlay?.setFormModified
	const setTarget = embed?.setTarget

	// The pane's own document, and only that one. A document drawer opened from inside the pane
	// carries this component too, and its actions belong to the drawer rather than to the panel.
	const isPaneDocument = Boolean(
		embed?.itemType === 'collection' &&
			collectionSlug === itemSlug &&
			docID &&
			docID === embed?.docID
	)

	const request = useCallback(
		async (args: { body?: Record<string, unknown>; method: string; path: `/${string}` }) => {
			const response = await fetch(formatAdminURL({ apiRoute, path: args.path }), {
				body: args.body ? JSON.stringify(args.body) : undefined,
				credentials: 'include',
				headers: { 'Accept-Language': i18n.language, 'Content-Type': 'application/json' },
				method: args.method,
			})
			const json = (await response.json().catch(() => null)) as null | {
				doc?: { id: number | string }
				errors?: { message?: string }[]
				message?: string
			}
			return { json, ok: response.status < 400 }
		},
		[apiRoute, i18n.language]
	)

	const invalidateLists = useCallback(() => {
		if (collectionSlug) {
			void queryClient.invalidateQueries({ queryKey: overlayKeys.lists(collectionSlug) })
		}
	}, [collectionSlug, queryClient])

	// Leaving the form for the list is what a delete means here, and the render of a document that
	// no longer exists must not be handed back on the next open.
	const leaveForList = useCallback(() => {
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

	// `Translation` types its `t` prop with the server key union while `useTranslation` returns the
	// wider client one, and `TFunction` is invariant in that parameter. Upstream pairs the same two
	// without complaint because both sit inside the package; from outside the mismatch surfaces.
	const bodyT = t as unknown as TFunction

	const collectionConfig = collectionSlug ? getEntityConfig({ collectionSlug }) : undefined
	const label = getTranslation(collectionConfig?.labels?.singular ?? '', i18n)
	const hasDrafts = collectionConfig ? hasDraftsEnabled(collectionConfig) : false

	/** Mirrors `shouldPermanentlyDelete`: no trash permission means there is no trash to move to. */
	const permanent = !hasTrashPermission || (Boolean(hasDeletePermission) && deletePermanently)

	const onDelete = useCallback(async () => {
		setModified(false)
		const { json, ok } = await request(
			permanent
				? { method: 'DELETE', path: `/${collectionSlug}/${docID}` }
				: {
						body: { deletedAt: new Date().toISOString() },
						method: 'PATCH',
						path: `/${collectionSlug}/${docID}`,
					}
		)
		if (!ok) {
			toast.error(json?.errors?.[0]?.message ?? t('error:deletingTitle', { title }))
			return
		}
		toast.success(t(permanent ? 'general:titleDeleted' : 'general:titleTrashed', { label, title }))
		leaveForList()
	}, [collectionSlug, docID, label, leaveForList, permanent, request, setModified, t, title])

	const onPermanentlyDelete = useCallback(async () => {
		const { json, ok } = await request({
			method: 'DELETE',
			path: `/${collectionSlug}${trashedDocQuery(docID ?? '')}`,
		})
		if (!ok) {
			toast.error(json?.errors?.[0]?.message ?? t('error:deletingTitle', { title }))
			return
		}
		toast.success(t('general:titleDeleted', { label, title }))
		leaveForList()
	}, [collectionSlug, docID, label, leaveForList, request, t, title])

	const onRestore = useCallback(async () => {
		const { json, ok } = await request({
			body: {
				deletedAt: null,
				...(hasDrafts ? { _status: restoreAsPublished ? 'published' : 'draft' } : {}),
			},
			method: 'PATCH',
			path: `/${collectionSlug}${trashedDocQuery(docID ?? '')}`,
		})
		if (!ok) {
			toast.error(json?.errors?.[0]?.message ?? t('error:restoringTitle', { title }))
			return
		}
		toast.success(t('general:titleRestored', { label, title }))
		invalidateLists()
		if (collectionSlug) {
			void queryClient.invalidateQueries({
				queryKey: overlayKeys.document('collection', collectionSlug, docID),
			})
		}
	}, [
		collectionSlug,
		docID,
		hasDrafts,
		invalidateLists,
		label,
		queryClient,
		request,
		restoreAsPublished,
		t,
		title,
	])

	const onDuplicate = useCallback(async () => {
		const { json, ok } = await request({
			body: hasDrafts ? { _status: 'draft' } : {},
			method: 'POST',
			path: `/${collectionSlug}/${docID}/duplicate`,
		})
		if (!ok || !json?.doc) {
			toast.error(json?.errors?.[0]?.message ?? t('error:unspecific', { label }))
			return
		}
		toast.success(json.message || t('general:successfullyDuplicated', { label }))
		setModified(false)
		invalidateLists()
		if (itemSlug) {
			setTarget?.({ id: String(json.doc.id), item: itemSlug })
		}
	}, [
		collectionSlug,
		docID,
		hasDrafts,
		invalidateLists,
		itemSlug,
		label,
		request,
		setModified,
		setTarget,
		t,
	])

	const onCreateNew = useCallback(() => {
		if (itemSlug) {
			setTarget?.({ id: 'new', item: itemSlug })
		}
	}, [itemSlug, setTarget])

	if (!isPaneDocument || !collectionSlug || !docID) {
		return null
	}

	const deleteSlug = `settings-overlay-delete-${docID}`
	const duplicateSlug = `settings-overlay-duplicate-${docID}`
	const permanentSlug = `settings-overlay-perma-delete-${docID}`
	const restoreSlug = `settings-overlay-restore-${docID}`

	const canCreate = permissions?.collections?.[collectionSlug]?.create === true
	const canDelete = Boolean(hasDeletePermission) && !isTrashed
	const canDuplicate = canCreate && collectionConfig?.disableDuplicate !== true && !isTrashed
	const showCreate = canCreate && !isTrashed

	return (
		<div className={baseClass}>
			{isTrashed && hasDeletePermission ? (
				<Fragment>
					<Button
						buttonStyle="secondary"
						id="settings-overlay-permanently-delete"
						onClick={() => {
							openModal(permanentSlug)
						}}
					>
						{t('general:permanentlyDelete')}
					</Button>
					<ConfirmationModal
						body={
							<Translation
								elements={{ '1': ({ children }) => <strong>{children}</strong> }}
								i18nKey="general:aboutToPermanentlyDelete"
								t={bodyT}
								variables={{ label, title: title || docID }}
							/>
						}
						confirmingLabel={t('general:deleting')}
						heading={t('general:confirmDeletion')}
						modalSlug={permanentSlug}
						onConfirm={onPermanentlyDelete}
					/>
				</Fragment>
			) : null}
			{isTrashed && hasSavePermission ? (
				<Fragment>
					<Button
						buttonStyle="primary"
						id="settings-overlay-restore"
						onClick={() => {
							openModal(restoreSlug)
						}}
					>
						{t('general:restore')}
					</Button>
					<ConfirmationModal
						body={
							<Fragment>
								<Translation
									elements={{ '1': ({ children }) => <strong>{children}</strong> }}
									i18nKey={hasDrafts ? 'general:aboutToRestoreAsDraft' : 'general:aboutToRestore'}
									t={bodyT}
									variables={{ label, title: title || docID }}
								/>
								{hasDrafts ? (
									<div className={`${baseClass}__checkbox`}>
										<CheckboxInput
											checked={restoreAsPublished}
											id="settings-overlay-restore-as-published"
											label={t('general:restoreAsPublished')}
											name="settings-overlay-restore-as-published"
											onToggle={(event) => {
												setRestoreAsPublished(event.target.checked)
											}}
										/>
									</div>
								) : null}
							</Fragment>
						}
						confirmingLabel={t('general:restoring')}
						heading={t('general:confirmRestoration')}
						modalSlug={restoreSlug}
						onConfirm={onRestore}
					/>
				</Fragment>
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
								{t('general:createNew')}
							</PopupList.Button>
						) : null}
						{canDuplicate ? (
							<PopupList.Button
								id="settings-overlay-duplicate"
								onClick={() => {
									openModal(duplicateSlug)
								}}
							>
								{t('general:duplicate')}
							</PopupList.Button>
						) : null}
						{canDelete ? (
							<PopupList.Button
								id="settings-overlay-delete"
								onClick={() => {
									openModal(deleteSlug)
								}}
							>
								{t('general:delete')}
							</PopupList.Button>
						) : null}
					</PopupList.ButtonGroup>
				</Popup>
			) : null}
			{canDuplicate ? (
				<ConfirmationModal
					body={t('general:unsavedChangesDuplicate')}
					confirmLabel={t('general:duplicateWithoutSaving')}
					heading={t('general:duplicate')}
					modalSlug={duplicateSlug}
					onConfirm={onDuplicate}
				/>
			) : null}
			{canDelete ? (
				<ConfirmationModal
					body={
						<Fragment>
							<Translation
								elements={{ '1': ({ children }) => <strong>{children}</strong> }}
								i18nKey={hasTrashPermission ? 'general:aboutToTrash' : 'general:aboutToDelete'}
								t={bodyT}
								variables={{ label, title: title || docID }}
							/>
							{hasTrashPermission && hasDeletePermission ? (
								<div className={`${baseClass}__checkbox`}>
									<CheckboxInput
										checked={deletePermanently}
										id="settings-overlay-delete-forever"
										label={t('general:deletePermanently')}
										name="settings-overlay-delete-forever"
										onToggle={(event) => {
											setDeletePermanently(event.target.checked)
										}}
									/>
								</div>
							) : null}
						</Fragment>
					}
					confirmingLabel={t('general:deleting')}
					heading={t('general:confirmDeletion')}
					modalSlug={deleteSlug}
					onConfirm={onDelete}
				/>
			) : null}
		</div>
	)
}
