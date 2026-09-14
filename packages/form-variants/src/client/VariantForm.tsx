'use client'

import {
	DocumentLocked,
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
	useRouteCache,
	useRouteTransition,
	useServerFunctions,
	useUploadEdits,
} from '@payloadcms/ui'
import { abortAndIgnore, handleAbortRef } from '@payloadcms/ui/utilities/abortAndIgnore'
import { handleBackToDashboard } from '@payloadcms/ui/utilities/handleBackToDashboard'
import { handleGoBack } from '@payloadcms/ui/utilities/handleGoBack'
import { handleTakeOver } from '@payloadcms/ui/utilities/handleTakeOver'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ClientCollectionConfig, ClientUser, FormState, JsonObject } from 'payload'
import { formatAdminURL, hasAutosaveEnabled } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BASE_CLASS, VARIANT_PARAM } from '../plugin/constants'
import type { AfterSaveAction } from '../types'
import { Header } from './chrome/Header'
import { SaveControls } from './chrome/SaveControls'
import { VariantSwitcher } from './chrome/VariantSwitcher'
import { useFormVariants } from './context'
import { evaluate } from './evaluate'
import { DrawerHeader, StaleDataModal } from './internals'
import { Runner } from './Runner'
import { resolveSlot } from './slots'
import type { ClientVariant, VariantProviderProps } from './types'
import './styles.css'

const PENDING_SUCCESS_TOAST_KEY = 'payload-pending-success-toast'

type Props = VariantProviderProps & { variant: ClientVariant }

/**
 * Whether a save came from Payload's `Autosave`, which is the one caller that turns
 * `getDocPermissions` off in its submit context. Autosave never triggers `afterSave`.
 */
const isAutosave = (context: Record<string, unknown> | undefined): boolean =>
	context?.getDocPermissions === false

/**
 * The plugin's own edit form: Payload's `Form` and document modals, the variant's top bar,
 * and the step runner. It is not a copy of `DefaultEditView`: there is no document controls
 * bar (status menu, duplicate, delete, preview, autosave), which stays on `native`.
 *
 * Owning the form is what makes the save guard, `afterSave` and value-preserving switching
 * between step variants possible. The save flow (the create redirect, drawer callbacks,
 * locking, stale-data detection, upload edits) follows `DefaultEditView` so a document saves
 * the same way on either surface.
 */
export const VariantForm: React.FC<Props> = (props) => {
	const { documentSlots, variant } = props
	const {
		id,
		action,
		collectionSlug,
		currentEditor,
		data,
		disableLeaveWithoutSaving,
		docPermissions,
		documentIsLocked,
		documentLockState,
		getDocPermissions,
		getDocPreferences,
		hasSavePermission,
		incrementVersionCount,
		initialState,
		isEditing,
		isInitializing,
		isLocked,
		isTrashed,
		lastUpdateTime,
		redirectAfterCreate,
		setCurrentEditor,
		setData,
		setDocumentIsLocked,
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
	const { reportUpdate } = useDocumentEvents()
	const { resetUploadEdits } = useUploadEdits()
	const { getFormState } = useServerFunctions()
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

	const abortOnChangeRef = useRef<AbortController | null>(null)
	const abortOnSaveRef = useRef<AbortController | null>(null)
	const locale = params.get('locale')
	const operation = collectionSlug && !id ? 'create' : 'update'
	const auth = collectionConfig?.auth
	const upload = collectionConfig?.upload
	const lockDocumentsProp = collectionConfig?.lockDocuments ?? true
	const isLockingEnabled = lockDocumentsProp !== false
	const lockDuration = typeof lockDocumentsProp === 'object' ? lockDocumentsProp.duration : 300
	const lockDurationInMilliseconds = lockDuration * 1000
	const autosaveEnabled = collectionConfig ? hasAutosaveEnabled(collectionConfig) : false
	const [isReadOnlyForIncomingUser, setIsReadOnlyForIncomingUser] = useState(false)
	const [showTakeOverModal, setShowTakeOverModal] = useState(false)
	const [showStaleDataModal, setShowStaleDataModal] = useState(false)
	const [editSessionStartTime, setEditSessionStartTime] = useState(Date.now())
	const hasCheckedForStaleDataRef = useRef(false)
	const originalUpdatedAtRef = useRef<string | undefined>(data?.updatedAt as string | undefined)
	const saveCounterRef = useRef(0)
	const isSavingRef = useRef(false)
	const lockExpiryTime = lastUpdateTime + lockDurationInMilliseconds
	const isLockExpired = Date.now() > lockExpiryTime
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

	const handleDocumentLocking = useCallback(
		(lockedState: { lastEditedAt?: string; user?: ClientUser | number | string } | undefined) => {
			setDocumentIsLocked?.(true)
			const previousOwnerID =
				typeof documentLockState.current?.user === 'object'
					? documentLockState.current?.user?.id
					: documentLockState.current?.user
			if (lockedState?.user) {
				const lockedUserID =
					typeof lockedState.user === 'string' || typeof lockedState.user === 'number'
						? lockedState.user
						: lockedState.user.id
				if (!documentLockState.current || lockedUserID !== previousOwnerID) {
					if (previousOwnerID === user?.id && lockedUserID !== user?.id) {
						setShowTakeOverModal(true)
						if (documentLockState.current) {
							documentLockState.current.hasShownLockedModal = true
						}
					}
					documentLockState.current = {
						hasShownLockedModal: documentLockState.current?.hasShownLockedModal || false,
						isLocked: true,
						user: lockedState.user,
					}
					setCurrentEditor?.(lockedState.user as ClientUser)
				}
				if (lockedState.lastEditedAt) {
					setLastUpdateTime(new Date(lockedState.lastEditedAt).getTime())
				}
			}
		},
		[documentLockState, setCurrentEditor, setDocumentIsLocked, setLastUpdateTime, user?.id]
	)

	const handleStaleDataReload = useCallback(() => {
		setShowStaleDataModal(false)
		router.refresh()
	}, [router])

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
					setCurrentEditor?.(null as unknown as ClientUser)
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
					serverURL,
				})
				return response.action ?? null
			} catch (error) {
				toast.error(error instanceof Error ? error.message : String(error))
				return null
			}
		},
		[apiRoute, collectionSlug, id, inDrawer, serverURL, variant.hasAfterSave, variant.key]
	)

	const onSave = useCallback<NonNullable<FormProps['onSuccess']>>(
		async (json, ctx) => {
			const { context, formState } = ctx || {}
			const controller = handleAbortRef(abortOnSaveRef as React.RefObject<AbortController>)
			const response = json as { doc?: JsonObject; message?: string; result?: JsonObject }
			const document = response?.doc || response?.result
			const updatedAt = (document?.updatedAt as string | undefined) || new Date().toISOString()

			if (user && collectionSlug === userSlug && id === user.id) {
				void refreshCookieAsync()
			}
			setLastUpdateTime(new Date(updatedAt).getTime())
			originalUpdatedAtRef.current = updatedAt
			hasCheckedForStaleDataRef.current = false
			isSavingRef.current = false

			if (context?.incrementVersionCount !== false) {
				incrementVersionCount()
			}
			if (typeof setData === 'function') {
				void setData(document || {})
			}
			const saveOperation = id ? 'update' : 'create'
			if (typeof onSaveFromContext === 'function') {
				void onSaveFromContext({
					...(json as object),
					context,
					doc: document as { id: number | string },
					operation: saveOperation,
					result: document ?? {},
				} as Parameters<typeof onSaveFromContext>[0])
			}

			const isPageCreate = !isEditing && depth < 2 && redirectAfterCreate !== false
			const action = isAutosave(context) ? null : await runAfterSave(document, saveOperation)

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

			if (context?.getDocPermissions !== false) {
				await getDocPermissions(json as JsonObject)
			}

			if (id) {
				const docPreferences = await getDocPreferences()
				const { state } = await getFormState({
					id,
					collectionSlug,
					data: document,
					docPermissions,
					docPreferences,
					formState,
					operation,
					renderAllFields: false,
					returnLockStatus: false,
					schemaPath: schemaPathSegments.join('.'),
					signal: controller.signal,
					skipValidation: true,
				})
				if (upload && state) {
					delete state.file
				}
				if (isLockingEnabled) {
					setDocumentIsLocked?.(false)
				}
				reportUpdate({
					id,
					doc: document,
					drawerSlug,
					entitySlug: collectionSlug,
					operation: 'update',
					updatedAt,
				} as Parameters<typeof reportUpdate>[0])
				abortOnSaveRef.current = null
				return state
			}
			reportUpdate({
				id,
				doc: document,
				drawerSlug,
				entitySlug: collectionSlug,
				operation: 'create',
				updatedAt,
			} as Parameters<typeof reportUpdate>[0])
		},
		[
			adminRoute,
			collectionSlug,
			depth,
			docPermissions,
			drawerSlug,
			getDocPermissions,
			getDocPreferences,
			getFormState,
			id,
			incrementVersionCount,
			isEditing,
			isLockingEnabled,
			locale,
			onSaveFromContext,
			operation,
			redirectAfterCreate,
			refreshCookieAsync,
			reportUpdate,
			resetUploadEdits,
			router,
			runAfterSave,
			schemaPathSegments,
			setData,
			setDocumentIsLocked,
			setLastUpdateTime,
			setOutcome,
			startRouteTransition,
			switchTo,
			upload,
			user,
			userSlug,
		]
	)

	const onChange = useCallback<NonNullable<FormProps['onChange']>[number]>(
		async ({ formState: prevFormState, submitted }) => {
			onFormChangeRef.current?.()
			const controller = handleAbortRef(abortOnChangeRef as React.RefObject<AbortController>)
			const saveCounterAtStart = saveCounterRef.current
			const isSavingAtStart = isSavingRef.current
			const dataUpdatedAt = data?.updatedAt as string | undefined
			if (
				dataUpdatedAt &&
				(!originalUpdatedAtRef.current || dataUpdatedAt > originalUpdatedAtRef.current)
			) {
				originalUpdatedAtRef.current = dataUpdatedAt
				hasCheckedForStaleDataRef.current = false
			}
			const currentTime = Date.now()
			const updateLastEdited = isLockingEnabled && currentTime - editSessionStartTime >= 10000
			if (updateLastEdited) {
				setEditSessionStartTime(currentTime)
			}
			const checkForStaleData =
				!hasCheckedForStaleDataRef.current &&
				Boolean(originalUpdatedAtRef.current) &&
				operation === 'update' &&
				!autosaveEnabled
			if (checkForStaleData) {
				hasCheckedForStaleDataRef.current = true
			}
			const docPreferences = await getDocPreferences()
			const result = await getFormState({
				id,
				checkForStaleData,
				collectionSlug,
				docPermissions,
				docPreferences,
				formState: prevFormState,
				operation,
				originalUpdatedAt: checkForStaleData ? originalUpdatedAtRef.current : undefined,
				renderAllFields: false,
				returnLockStatus: isLockingEnabled,
				schemaPath: schemaPathSegments.join('.'),
				signal: controller.signal,
				skipValidation: !submitted,
				updateLastEdited,
			})
			if (!result) {
				return prevFormState
			}
			const { lockedState, staleDataState, state } = result
			if (isLockingEnabled) {
				handleDocumentLocking(lockedState)
			}
			if (
				staleDataState?.isStale &&
				!isSavingAtStart &&
				saveCounterRef.current === saveCounterAtStart
			) {
				setShowStaleDataModal(true)
			}
			abortOnChangeRef.current = null
			return state as FormState
		},
		[
			autosaveEnabled,
			collectionSlug,
			data?.updatedAt,
			docPermissions,
			editSessionStartTime,
			getDocPreferences,
			getFormState,
			handleDocumentLocking,
			id,
			isLockingEnabled,
			operation,
			schemaPathSegments,
		]
	)

	useEffect(() => {
		return () => {
			setShowTakeOverModal(false)
		}
	}, [])

	useEffect(() => {
		const abortOnChange = abortOnChangeRef.current
		const abortOnSave = abortOnSaveRef.current
		return () => {
			if (abortOnChange) {
				abortAndIgnore(abortOnChange)
			}
			if (abortOnSave) {
				abortAndIgnore(abortOnSave)
			}
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
	const isFolderCollection = Boolean(config.folders && collectionSlug === config.folders?.slug)

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
			user: user as ClientUser,
		})
	}

	const header = (
		<Header>
			{documentSlots.BeforeDocumentControls}
			{switcher}
			{variant.save === 'always' && !readOnly && <SaveControls />}
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
					onSubmit={() => {
						saveCounterRef.current += 1
						isSavingRef.current = true
					}}
					onSuccess={onSave}
				>
					{isInDrawer && (
						<DrawerHeader
							AfterHeader={documentSlots.Description}
							drawerSlug={drawerSlug}
							showDocumentID={!isFolderCollection}
						/>
					)}
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
					{showStaleDataModal && (
						<StaleDataModal isActive={showStaleDataModal} onReload={handleStaleDataReload} />
					)}
					{preventLeaveWithoutSaving && (
						<LeaveWithoutSaving onConfirm={handleLeaveConfirm} onPrevent={handlePrevent} />
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
