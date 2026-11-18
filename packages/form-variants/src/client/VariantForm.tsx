'use client'

import {
	DocumentLocked,
	DocumentStaleData,
	DocumentTakeOver,
	Form,
	type FormProps,
	LeaveWithoutSaving,
	OperationProvider,
	SetDocumentStepNav,
	SetDocumentTitle,
	toast,
	Upload,
	useAuth,
	useConfig,
	useDocumentDrawerContext,
	useDocumentEvents,
	useDocumentInfo,
	useEditDepth,
	useLocale,
	useRouteCache,
	useRouter,
	useRouteTransition,
	useSearchParams,
	useUploadEdits,
} from '@payloadcms/ui'
import { handleBackToDashboard } from '@payloadcms/ui/utilities/handleBackToDashboard'
import { handleGoBack } from '@payloadcms/ui/utilities/handleGoBack'
import { handleTakeOver } from '@payloadcms/ui/utilities/handleTakeOver'
import type { ClientCollectionConfig, JsonObject, User } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BASE_CLASS, VARIANT_PARAM } from '../plugin/constants'
import type { AfterSaveAction } from '../types'
import { Header } from './chrome/Header'
import { SaveControls } from './chrome/SaveControls'
import { VariantSwitcher } from './chrome/VariantSwitcher'
import { useFormVariants } from './context'
import { evaluate } from './evaluate'
import { FormStateBridge } from './handoff'
import { DrawerHeader } from './internals'
import { Runner } from './Runner'
import { resolveSlot } from './slots'
import type { ClientVariant, VariantProviderProps } from './types'
import './styles.css'

const PENDING_SUCCESS_TOAST_KEY = 'payload-pending-success-toast'

type Props = VariantProviderProps & { variant: ClientVariant }

/**
 * The plugin's own edit form: Payload's `Form` and document modals, the variant's top bar,
 * and the step runner. It is not a copy of `DefaultEditView`: there is no document controls
 * bar (status menu, duplicate, delete, preview, autosave), which stays on `native`.
 *
 * Owning the form is what makes the save guard, `afterSave` and value-preserving switching
 * between step variants possible. The save flow (the create redirect, drawer callbacks,
 * locking, stale-data detection, upload edits) follows `DefaultEditView` so a document saves
 * the same way on either surface. As there, `Form` refreshes its own state after a save and on
 * every change, and reports locks and stale data through `useDocumentInfo`.
 */
export const VariantForm: React.FC<Props> = (props) => {
	const { documentSlots, variant } = props
	const {
		id,
		action,
		collectionSlug,
		currentEditor,
		disableLeaveWithoutSaving,
		documentIsLocked,
		documentLockState,
		hasSavePermission,
		incrementVersionCount,
		initialState,
		isEditing,
		isInitializing,
		isLocked,
		isStale,
		isTrashed,
		lastUpdateTime,
		redirectAfterCreate,
		setCurrentEditor,
		setData,
		setDocumentIsLocked,
		setIsStale,
		setLastUpdateTime,
		unlockDocument,
		updateDocumentEditor,
	} = useDocumentInfo()
	const { drawerSlug, onSave: onSaveFromContext } = useDocumentDrawerContext()
	const isInDrawer = Boolean(drawerSlug)
	const { refreshCookieAsync, user } = useAuth()
	const {
		config,
		config: {
			admin: { user: userSlug },
			routes: { admin: adminRoute, api: apiRoute },
			serverURL,
		},
		getEntityConfig,
	} = useConfig()
	const collectionConfig = getEntityConfig({ collectionSlug }) as ClientCollectionConfig | null
	const depth = useEditDepth()
	const router = useRouter()
	const params = useSearchParams()
	const localeCode = useLocale()?.code
	const { reportUpdate } = useDocumentEvents()
	const { resetUploadEdits } = useUploadEdits()
	const { startRouteTransition } = useRouteTransition()
	const { clearRouteCache } = useRouteCache()
	const { available, inDrawer, setOutcome, state: wizardState, switchTo } = useFormVariants()
	const variantSlots = props.slots.variants[variant.key]
	const switcher =
		available.length > 1
			? (resolveSlot('VariantSwitcher', [
					variantSlots?.variant,
					props.slots.collection,
					props.slots.plugin,
				]) ?? <VariantSwitcher />)
			: null

	const locale = params.get('locale')
	const operation = collectionSlug && !id ? 'create' : 'update'
	const auth = collectionConfig?.auth
	const upload = collectionConfig?.upload
	const lockDocumentsProp = collectionConfig?.lockDocuments ?? true
	const isLockingEnabled = lockDocumentsProp !== false
	const lockDuration = typeof lockDocumentsProp === 'object' ? lockDocumentsProp.duration : 300
	const lockDurationInMilliseconds = lockDuration * 1000
	const [isReadOnlyForIncomingUser, setIsReadOnlyForIncomingUser] = useState(false)
	const [showTakeOverModal, setShowTakeOverModal] = useState(false)
	const lockExpiryTime = lastUpdateTime + lockDurationInMilliseconds
	// Render cannot read the clock, so the lock's expiry is state, flipped by a timer the moment
	// it passes, which is what hides the locked-document modal. As on the native form.
	const [isLockExpired, setIsLockExpired] = useState(() => Date.now() > lockExpiryTime)

	useEffect(() => {
		const msUntilExpiry = lockExpiryTime - Date.now()
		setIsLockExpired(msUntilExpiry < 0)
		if (msUntilExpiry >= 0 && msUntilExpiry <= 2_147_483_647) {
			const timeout = setTimeout(() => setIsLockExpired(true), msUntilExpiry)
			return () => clearTimeout(timeout)
		}
	}, [lockExpiryTime])
	// Unlike the native view this form never autosaves, so leaving always risks unsaved values.
	const preventLeaveWithoutSaving = !isReadOnlyForIncomingUser && !disableLeaveWithoutSaving
	const schemaPathSegments = useMemo(() => [collectionSlug ?? ''], [collectionSlug])
	const validateBeforeSubmit = Boolean(operation === 'create' && auth && !auth.disableLocalStrategy)
	const nextHrefRef = useRef<null | string>(null)
	// Filled in by the runner. Payload debounces `onChange` and only fires it on a real change,
	// so it is the cheapest place to tell the step engine that the values moved.
	const onFormChangeRef = useRef<(() => void) | null>(null)
	const wizardStateRef = useRef(wizardState)
	wizardStateRef.current = wizardState

	const currentEditorID = typeof currentEditor === 'object' ? currentEditor?.id : currentEditor
	const previousEditorIDRef = useRef(currentEditorID)

	// Another user took the lock over from the current one.
	useEffect(() => {
		const previousEditorID = previousEditorIDRef.current
		previousEditorIDRef.current = currentEditorID
		if (
			isLockingEnabled &&
			previousEditorID === user?.id &&
			currentEditorID &&
			currentEditorID !== user?.id &&
			documentLockState.current
		) {
			setShowTakeOverModal(true)
			documentLockState.current.hasShownLockedModal = true
		}
	}, [currentEditorID, documentLockState, isLockingEnabled, user?.id])

	const handleStaleDataReload = useCallback(() => {
		setIsStale(false)
		router.refresh()
	}, [router, setIsStale])

	const handlePrevent = useCallback((nextHref: null | string) => {
		nextHrefRef.current = nextHref
	}, [])

	const handleLeaveConfirm = useCallback(async () => {
		const lockUser = documentLockState.current?.user
		const isLockOwnedByCurrentUser =
			typeof lockUser === 'object' ? lockUser?.id === user?.id : lockUser === user?.id
		if (isLockingEnabled && documentIsLocked && id && collectionSlug) {
			const nextPath = nextHrefRef.current ? new URL(nextHrefRef.current).pathname : ''
			const isInternalView = ['/preview', '/api', '/versions'].some((path) =>
				nextPath.includes(path)
			)
			if (isLockOwnedByCurrentUser && !isInternalView) {
				try {
					await unlockDocument(id, collectionSlug)
					setDocumentIsLocked?.(false)
					setCurrentEditor?.(null as unknown as User)
				} catch (err) {
					console.error('Failed to unlock before leave', err)
				}
			}
		}
	}, [
		collectionSlug,
		documentIsLocked,
		documentLockState,
		id,
		isLockingEnabled,
		setCurrentEditor,
		setDocumentIsLocked,
		unlockDocument,
		user?.id,
	])

	/**
	 * Runs `afterSave` through the endpoint; a failed call falls back to Payload's behaviour.
	 * The server reads the saved document itself, so only its id and the operation are sent.
	 */
	const runAfterSave = useCallback(
		async (
			document: JsonObject | undefined,
			saveOperation: 'create' | 'update'
		): Promise<AfterSaveAction> => {
			const savedID = (document?.id as number | string | undefined) ?? id
			if (!variant.hasAfterSave || !collectionSlug || !savedID) {
				return null
			}
			try {
				const response = await evaluate({
					apiRoute,
					body: {
						collection: collectionSlug,
						id: savedID,
						inDrawer,
						operation: saveOperation,
						phase: 'afterSave',
						state: wizardStateRef.current,
						variant: variant.key,
					},
					locale: localeCode,
					serverURL,
				})
				return response.action ?? null
			} catch (error) {
				toast.error(error instanceof Error ? error.message : String(error))
				return null
			}
		},
		[
			apiRoute,
			collectionSlug,
			id,
			inDrawer,
			localeCode,
			serverURL,
			variant.hasAfterSave,
			variant.key,
		]
	)

	const onSave = useCallback<NonNullable<FormProps['onSuccess']>>(
		async (json, ctx) => {
			const { context, isCurrent = () => true } = ctx || {}
			const response = json as { doc?: JsonObject; message?: string; result?: JsonObject }
			const document = response?.doc || response?.result
			const updatedAt = (document?.updatedAt as string | undefined) || new Date().toISOString()

			if (user && collectionSlug === userSlug && id === user.id) {
				void refreshCookieAsync()
			}
			if (isCurrent()) {
				setLastUpdateTime(new Date(updatedAt).getTime())
				if (context?.incrementVersionCount !== false) {
					incrementVersionCount()
				}
				if (typeof setData === 'function') {
					void setData(document || {})
				}
			}
			const saveOperation = id ? 'update' : 'create'
			if (typeof onSaveFromContext === 'function') {
				void onSaveFromContext({
					...(json as object),
					context,
					operation: saveOperation,
					updatedAt:
						saveOperation === 'update'
							? new Date().toISOString()
							: (document?.updatedAt ?? new Date().toISOString()),
				} as unknown as Parameters<typeof onSaveFromContext>[0])
			}

			reportUpdate({
				id,
				doc: document,
				drawerSlug,
				entitySlug: collectionSlug,
				operation: saveOperation,
				updatedAt,
			} as Parameters<typeof reportUpdate>[0])

			// The form was reset or unmounted while the save was in flight: nothing below is its own.
			if (!isCurrent()) {
				return
			}
			if (id && isLockingEnabled) {
				setDocumentIsLocked?.(false)
			}

			const isPageCreate = !isEditing && depth < 2 && redirectAfterCreate !== false
			// Every save here is a deliberate one: the variant form renders no `Autosave`, so
			// `afterSave` needs no exception for the writes autosave would otherwise make.
			const action = await runAfterSave(document, saveOperation)
			if (!isCurrent()) {
				return
			}

			if (action && 'redirect' in action) {
				startRouteTransition(() => router.push(action.redirect))
				return
			}
			if (action && 'outcome' in action) {
				setOutcome(action.outcome)
				resetUploadEdits()
				return
			}
			if (action && 'switchTo' in action) {
				if (isPageCreate && collectionSlug) {
					const redirectRoute = formatAdminURL({
						adminRoute,
						path: `/collections/${collectionSlug}/${document?.id}?${VARIANT_PARAM}=${encodeURIComponent(action.switchTo)}${locale ? `&locale=${locale}` : ''}`,
					})
					startRouteTransition(() => router.push(redirectRoute))
					return
				}
				switchTo(action.switchTo, { persist: false })
			}

			if (isPageCreate) {
				if (response.message && typeof window !== 'undefined') {
					window.sessionStorage.setItem(PENDING_SUCCESS_TOAST_KEY, response.message)
				}
				const redirectRoute = formatAdminURL({
					adminRoute,
					path: `/collections/${collectionSlug}/${document?.id}${locale ? `?locale=${locale}` : ''}`,
				})
				startRouteTransition(() => router.push(redirectRoute))
			} else {
				resetUploadEdits()
			}
		},
		[
			adminRoute,
			collectionSlug,
			depth,
			drawerSlug,
			id,
			incrementVersionCount,
			isEditing,
			isLockingEnabled,
			locale,
			onSaveFromContext,
			redirectAfterCreate,
			refreshCookieAsync,
			reportUpdate,
			resetUploadEdits,
			router,
			runAfterSave,
			setData,
			setDocumentIsLocked,
			setLastUpdateTime,
			setOutcome,
			startRouteTransition,
			switchTo,
			user,
			userSlug,
		]
	)

	// Payload ignores what `onChange` returns: the form refreshes its own state.
	const onChange = useCallback<NonNullable<FormProps['onChange']>[number]>(() => {
		onFormChangeRef.current?.()
	}, [])

	useEffect(() => {
		return () => {
			setShowTakeOverModal(false)
		}
	}, [])

	useEffect(() => {
		if (!isInitializing && typeof window !== 'undefined') {
			const pendingMessage = window.sessionStorage.getItem(PENDING_SUCCESS_TOAST_KEY)
			if (pendingMessage) {
				window.sessionStorage.removeItem(PENDING_SUCCESS_TOAST_KEY)
				toast.success(pendingMessage)
			}
		}
	}, [isInitializing])

	const shouldShowDocumentLockedModal =
		documentIsLocked &&
		currentEditor &&
		(typeof currentEditor === 'object'
			? currentEditor.id !== user?.id
			: currentEditor !== user?.id) &&
		!isReadOnlyForIncomingUser &&
		!showTakeOverModal &&
		!documentLockState.current?.hasShownLockedModal &&
		!isLockExpired

	const readOnly = isReadOnlyForIncomingUser || !hasSavePermission || isTrashed === true
	// A folder collection's documents have no page of their own to link the title to.
	const isFolderCollection = Boolean(
		collectionConfig?.hierarchy &&
			typeof collectionConfig.hierarchy === 'object' &&
			collectionConfig.hierarchy.allowHasMany === false
	)

	/**
	 * Payload's own edit view passes `undefined` here, against the prop's declared `string`, and
	 * that is the point: `formatDocTitle` takes the fallback only when it is not a string, so an
	 * empty one becomes the document's title. An empty title then reads to `RenderTitle` as a
	 * document shown by its id, which on create is an empty `ID:` label where `[Untitled]` belongs.
	 */
	const titleFallback = (depth <= 1 ? id?.toString() : undefined) as string

	/** The variant's presentation for the surface it is on. The server answered both already. */
	const ui = variant.ui[inDrawer ? 'drawer' : 'page']

	/** Take-over from the locked-document modal; the read-only state has no take-over button here. */
	const takeOver = (): void => {
		if (!id) {
			return
		}
		void handleTakeOver({
			id,
			clearRouteCache,
			collectionSlug,
			documentLockStateRef: documentLockState as Parameters<
				typeof handleTakeOver
			>[0]['documentLockStateRef'],
			isLockingEnabled,
			isWithinDoc: false,
			setCurrentEditor: setCurrentEditor as Parameters<
				typeof handleTakeOver
			>[0]['setCurrentEditor'],
			updateDocumentEditor: updateDocumentEditor as Parameters<
				typeof handleTakeOver
			>[0]['updateDocumentEditor'],
			user: user as User,
		})
	}

	const controls = (
		<>
			{documentSlots.BeforeDocumentControls}
			{switcher}
			{variant.save === 'always' && !readOnly && <SaveControls />}
		</>
	)
	const lockedBy =
		isReadOnlyForIncomingUser && currentEditor && typeof currentEditor === 'object'
			? (currentEditor as User)
			: undefined

	// In a drawer the controls move into the drawer's own header bar, where Payload puts them.
	const header = isInDrawer ? (
		<DrawerHeader
			actions={
				<div className="doc-controls doc-controls--drawerHeaderActions">
					<div className="doc-controls__controls-wrapper">
						<div className="doc-controls__controls">{controls}</div>
					</div>
				</div>
			}
			AfterHeader={documentSlots.Description}
			BeforeDocumentMeta={documentSlots.BeforeDocumentMeta}
			drawerSlug={drawerSlug}
			readOnlyForIncomingUser={isReadOnlyForIncomingUser}
			renderTitleAsLink={!isFolderCollection}
			user={lockedBy}
		/>
	) : (
		<Header BeforeDocumentMeta={documentSlots.BeforeDocumentMeta} lockedBy={lockedBy}>
			{controls}
		</Header>
	)

	const beforeSteps =
		upload && collectionSlug
			? documentSlots.Upload || (
					<Upload
						collectionSlug={collectionSlug}
						initialState={initialState}
						uploadConfig={upload}
						UploadControls={documentSlots.UploadControls}
					/>
				)
			: null

	return (
		<main
			className={[
				'collection-edit',
				BASE_CLASS,
				id && 'collection-edit--is-editing',
				collectionSlug && `collection-edit--${collectionSlug}`,
				`${BASE_CLASS}--${variant.key}`,
				`${BASE_CLASS}--width-${ui.width}`,
				`${BASE_CLASS}--align-${ui.align}`,
			]
				.filter(Boolean)
				.join(' ')}
		>
			<OperationProvider operation={operation}>
				<Form
					action={action}
					className="collection-edit__form"
					disabled={isReadOnlyForIncomingUser || isInitializing || !hasSavePermission || isTrashed}
					disableSuccessStatus={!isEditing && depth < 2 && redirectAfterCreate !== false}
					disableValidationOnSubmit={!validateBeforeSubmit}
					initialState={!isInitializing ? initialState : undefined}
					isDocumentForm
					isInitializing={isInitializing}
					key={`${isLocked}`}
					method={id ? 'PATCH' : 'POST'}
					onChange={[onChange]}
					onSuccess={onSave}
				>
					<FormStateBridge />
					{isLockingEnabled && shouldShowDocumentLockedModal && (
						<DocumentLocked
							handleGoBack={() =>
								handleGoBack({
									adminRoute,
									collectionSlug: collectionSlug ?? '',
									router,
									serverURL,
								})
							}
							isActive={Boolean(shouldShowDocumentLockedModal)}
							onReadOnly={() => {
								setIsReadOnlyForIncomingUser(true)
								setShowTakeOverModal(false)
							}}
							onTakeOver={takeOver}
							updatedAt={lastUpdateTime}
							user={currentEditor ?? undefined}
						/>
					)}
					{isLockingEnabled && showTakeOverModal && (
						<DocumentTakeOver
							handleBackToDashboard={() => handleBackToDashboard({ adminRoute, router, serverURL })}
							isActive={showTakeOverModal}
							onReadOnly={() => {
								setIsReadOnlyForIncomingUser(true)
								setShowTakeOverModal(false)
							}}
						/>
					)}
					{isStale && <DocumentStaleData isActive={isStale} onReload={handleStaleDataReload} />}
					{preventLeaveWithoutSaving && (
						<LeaveWithoutSaving
							modalSlug={drawerSlug ? `leave-without-saving-${drawerSlug}` : undefined}
							onConfirm={handleLeaveConfirm}
							onPrevent={handlePrevent}
						/>
					)}
					{!isInDrawer && (
						<SetDocumentStepNav
							collectionSlug={collectionConfig?.slug}
							id={id}
							isTrashed={isTrashed}
							pluralLabel={collectionConfig?.labels?.plural}
							useAsTitle={collectionConfig?.admin?.useAsTitle}
						/>
					)}
					<SetDocumentTitle
						collectionConfig={collectionConfig ?? undefined}
						config={config}
						fallback={titleFallback}
					/>
					<Runner
						{...props}
						beforeSteps={beforeSteps}
						header={header}
						key={variant.key}
						onFormChange={onFormChangeRef}
						readOnly={readOnly}
						variant={variant}
					/>
				</Form>
			</OperationProvider>
		</main>
	)
}
