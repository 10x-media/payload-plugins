// biome-ignore-all lint/suspicious/noExplicitAny: This field is almost identical to the core Payload field
'use client'

import type { ListDrawerProps } from '@payloadcms/ui'
import {
	Button,
	Dropzone,
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	RenderCustomComponent,
	ShimmerEffect,
	useAuth,
	useBulkUpload,
	useDocumentDrawer,
	useListDrawer,
	useLocale,
	useModal,
	useTranslation,
} from '@payloadcms/ui'
import type {
	ClientCollectionConfig,
	ClientFieldWithOptionalType,
	FilterOptionsResult,
	JsonObject,
	StaticDescription,
	StaticLabel,
	UploadField as UploadFieldType,
	ValueWithRelation,
} from 'payload'
import type { FolderOrDocument } from 'payload/shared'
import { formatAdminURL } from 'payload/shared'
import * as qs from 'qs-esm'
import React, { useCallback, useEffect, useMemo } from 'react'

import { normalizeRelationshipValue } from '../../utilities/normalizeRelationshipValue'
import { useFolderPickerDrawer } from '../FolderPickerDrawer/useFolderPickerDrawer'

import { UploadComponentHasMany } from './HasMany/index'
import { UploadComponentHasOne } from './HasOne/index'
import type { ReloadDoc, ValueAsDataWithRelation } from './types'
import './index.scss'

export const baseClass = 'upload'

type PopulatedDocs = { relationTo: string; value: JsonObject }[]

export type FolderPickerInputProps = {
	readonly AfterInput?: React.ReactNode
	readonly allowCreate?: boolean
	readonly api?: string
	readonly BeforeInput?: React.ReactNode
	readonly className?: string
	readonly collection?: ClientCollectionConfig
	readonly customUploadActions?: React.ReactNode[]
	readonly Description?: React.ReactNode
	readonly description?: StaticDescription
	readonly displayPreview?: boolean
	readonly Error?: React.ReactNode
	readonly filterOptions?: FilterOptionsResult
	readonly folderEnabledRelations?: string[]
	readonly hasMany?: boolean
	readonly hideRemoveFile?: boolean
	readonly isSortable?: boolean
	readonly Label?: React.ReactNode
	readonly label?: StaticLabel
	readonly labelProps?: Partial<ClientFieldWithOptionalType>
	readonly localized?: boolean
	readonly maxRows?: number
	readonly onChange?: (e: unknown) => void
	readonly path: string
	readonly readOnly?: boolean
	readonly relationTo: UploadFieldType['relationTo']
	readonly required?: boolean
	readonly serverURL?: string
	readonly showError?: boolean
	readonly style?: React.CSSProperties
	readonly value?: (number | string)[] | number | string | ValueWithRelation | ValueWithRelation[]
}

export function FolderPickerInput(props: FolderPickerInputProps) {
	const {
		AfterInput,
		allowCreate,
		api,
		BeforeInput,
		className,
		Description,
		description,
		displayPreview,
		Error: ErrorComponent,
		filterOptions: filterOptionsFromProps,
		folderEnabledRelations,
		hasMany,
		isSortable,
		Label,
		label,
		localized,
		maxRows,
		onChange: onChangeFromProps,
		path,
		readOnly,
		relationTo,
		required,
		serverURL,
		showError,
		style,
		value,
	} = props

	const [populatedDocs, setPopulatedDocs] = React.useState<PopulatedDocs | undefined>()

	const [activeRelationTo] = React.useState<string>(
		Array.isArray(relationTo) ? (relationTo[0] as string) : (relationTo as string)
	)

	const { openModal } = useModal()
	const {
		drawerSlug: bulkUploadDrawerSlug,
		setCollectionSlug,
		setInitialFiles,
		setMaxFiles,
		setOnSuccess,
		setSelectableCollections,
	} = useBulkUpload()
	const { permissions } = useAuth()
	const { code } = useLocale()
	const { i18n, t } = useTranslation()

	const collectionSlugsWithCreatePermission = useMemo(() => {
		if (Array.isArray(relationTo)) {
			return relationTo.filter((relation) => permissions?.collections?.[relation]?.create)
		}
		return []
	}, [relationTo, permissions])

	const filterOptions: FilterOptionsResult | undefined = useMemo(() => {
		const isPoly = Array.isArray(relationTo)
		if (!value) return filterOptionsFromProps

		const existingIdsByRelation: Record<string, (number | string)[]> = {}
		const values = Array.isArray(value) ? value : [value]

		for (const val of values) {
			if (isPoly && typeof val === 'object' && 'relationTo' in val) {
				if (!existingIdsByRelation[val.relationTo]) {
					existingIdsByRelation[val.relationTo] = []
				}
				existingIdsByRelation[val.relationTo]?.push(val.value)
			} else if (!isPoly) {
				const collection = relationTo as string
				if (!existingIdsByRelation[collection]) existingIdsByRelation[collection] = []
				const id = typeof val === 'object' && 'value' in val ? val.value : val
				if (typeof id === 'string' || typeof id === 'number') {
					existingIdsByRelation[collection].push(id)
				}
			}
		}

		const newFilterOptions = { ...filterOptionsFromProps }
		const relations = isPoly ? relationTo : [relationTo as string]
		relations.forEach((relation) => {
			const existingIds = existingIdsByRelation[relation] || []
			newFilterOptions[relation] = {
				...((filterOptionsFromProps?.[relation] as any) || {}),
				id: {
					...((filterOptionsFromProps?.[relation] as any)?.id || {}),
					not_in: ((filterOptionsFromProps?.[relation] as any)?.id?.not_in || []).concat(
						existingIds
					),
				},
			}
		})

		return newFilterOptions
	}, [value, filterOptionsFromProps, relationTo])

	// ─── Folder Picker Drawer (replaces useListDrawer) ───────────────────────
	const collectionSlugsForPicker =
		folderEnabledRelations ?? (Array.isArray(relationTo) ? relationTo : [relationTo as string])

	const excludeIds = useMemo(() => {
		const ids = new Set<string | number>()
		if (!value || !hasMany) return ids
		const vals = Array.isArray(value) ? value : [value]
		for (const val of vals) {
			if (typeof val === 'string' || typeof val === 'number') {
				ids.add(val)
			} else if (val && typeof val === 'object' && 'value' in val) {
				const id = (val as any).value
				if (typeof id === 'string' || typeof id === 'number') ids.add(id)
			}
		}
		return ids
	}, [value, hasMany])

	const [FolderPickerDrawer, , { closeDrawer: closePickerDrawer, openDrawer: openPickerDrawer }] =
		useFolderPickerDrawer({
			collectionSlugs: collectionSlugsForPicker,
			excludeIds,
			filterOptions,
			hasMany,
		})

	const allRelationSlugs = useMemo(
		() => (Array.isArray(relationTo) ? relationTo : [relationTo as string]),
		[relationTo]
	)

	const [ListDrawer, , { closeDrawer: closeListDrawer, openDrawer: openListDrawer }] =
		useListDrawer({
			collectionSlugs: allRelationSlugs,
			filterOptions,
		})
	// ─────────────────────────────────────────────────────────────────────────

	const [
		CreateDocDrawer,
		,
		{ closeDrawer: closeCreateDocDrawer, openDrawer: openCreateDocDrawer },
	] = useDocumentDrawer({ collectionSlug: activeRelationTo })

	const loadedValueRef = React.useRef<
		(number | string)[] | null | number | string | ValueWithRelation | ValueWithRelation[]
	>(null)

	const canCreate = useMemo(() => {
		if (!allowCreate) return false
		if (typeof activeRelationTo === 'string') {
			if (permissions?.collections?.[activeRelationTo]?.create) {
				return true
			}
		}
		return false
	}, [activeRelationTo, permissions, allowCreate])

	const onChange = React.useCallback(
		(newValue: unknown) => {
			if (typeof onChangeFromProps === 'function') onChangeFromProps(newValue)
		},
		[onChangeFromProps]
	)

	const populateDocs = React.useCallback(
		async (items: ValueWithRelation[]): Promise<ValueAsDataWithRelation[]> => {
			if (!items?.length) return []

			const grouped: Record<string, (number | string)[]> = {}
			items.forEach(({ relationTo, value }) => {
				if (!grouped[relationTo]) grouped[relationTo] = []
				let idValue: number | string = value as any
				if (value && typeof value === 'object' && 'value' in (value as any)) {
					idValue = (value as any).value
				}
				grouped[relationTo].push(idValue)
			})

			const fetches = Object.entries(grouped).map(async ([collection, ids]) => {
				const query = {
					depth: 0,
					draft: true,
					limit: ids.length,
					locale: code,
					where: { and: [{ id: { in: ids } }] },
				}
				const response = await fetch(formatAdminURL({ apiRoute: api, path: `/${collection}` }), {
					body: qs.stringify(query),
					credentials: 'include',
					headers: {
						'Accept-Language': i18n.language,
						'Content-Type': 'application/x-www-form-urlencoded',
						'X-Payload-HTTP-Method-Override': 'GET',
					},
					method: 'POST',
				})
				let docs: any[] = []
				if (response.ok) {
					const data = await response.json()
					docs = data.docs
				}
				const docsById = docs.reduce((acc, doc) => {
					acc[doc.id] = doc
					return acc
				}, {})
				return { collection, docsById }
			})

			const results = await Promise.all(fetches)
			const lookup: Record<string, Record<string, any>> = {}
			results.forEach(({ collection, docsById }) => {
				lookup[collection] = docsById
			})

			return items.map(({ relationTo, value }) => {
				const doc = lookup[relationTo]?.[value as any] || {
					id: value,
					filename: `${t('general:untitled')} - ID: ${value}`,
					isPlaceholder: true,
				}
				return { relationTo, value: doc }
			})
		},
		[api, code, i18n.language, t]
	)

	const normalizeValue = useCallback(
		(value: any): any => normalizeRelationshipValue(value, relationTo),
		[relationTo]
	)

	const onUploadSuccess = useCallback(
		(uploadedForms: any[]) => {
			const isPoly = Array.isArray(relationTo)
			if (hasMany) {
				const newValues = uploadedForms.map((form) =>
					isPoly ? { relationTo: form.collectionSlug, value: form.doc.id } : form.doc.id
				)
				const normalizedExisting = Array.isArray(value) ? value.map(normalizeValue) : []
				onChange([...normalizedExisting, ...newValues])
				setPopulatedDocs((curr) => [
					...(curr || []),
					...uploadedForms.map((form) => ({ relationTo: form.collectionSlug, value: form.doc })),
				])
			} else {
				const firstDoc = uploadedForms[0]
				const newValue = isPoly
					? { relationTo: firstDoc.collectionSlug, value: firstDoc.doc.id }
					: firstDoc.doc.id
				onChange(newValue)
				setPopulatedDocs([{ relationTo: firstDoc.collectionSlug, value: firstDoc.doc }])
			}
		},
		[value, onChange, hasMany, relationTo, normalizeValue]
	)

	const onLocalFileSelection = React.useCallback(
		(fileList?: FileList) => {
			let fileListToUse = fileList
			if (!hasMany && fileList && fileList.length > 1) {
				const dt = new DataTransfer()
				if (fileList[0]) {
					dt.items.add(fileList[0])
				}
				fileListToUse = dt.files
			}
			if (fileListToUse) setInitialFiles(fileListToUse)
			const collectionToUse = Array.isArray(relationTo) ? activeRelationTo : (relationTo as string)
			setCollectionSlug(collectionToUse)
			if (Array.isArray(collectionSlugsWithCreatePermission)) {
				setSelectableCollections(collectionSlugsWithCreatePermission)
			}
			if (typeof maxRows === 'number') setMaxFiles(maxRows)
			openModal(bulkUploadDrawerSlug)
		},
		[
			hasMany,
			relationTo,
			activeRelationTo,
			setCollectionSlug,
			collectionSlugsWithCreatePermission,
			maxRows,
			openModal,
			bulkUploadDrawerSlug,
			setInitialFiles,
			setSelectableCollections,
			setMaxFiles,
		]
	)

	// Called from FolderPickerDrawer when hasMany=true and user confirms selection
	const onPickerBulkSelect = React.useCallback(
		async (selectedItems: FolderOrDocument[]) => {
			const isPoly = Array.isArray(relationTo)
			const itemsToLoad = selectedItems.map((item) => ({
				relationTo: item.relationTo,
				value: item.value.id as string | number,
			}))
			const loadedDocs = await populateDocs(itemsToLoad)
			if (loadedDocs) {
				setPopulatedDocs((curr) => [...(curr || []), ...loadedDocs])
			}
			const newValues = selectedItems.map((item) =>
				isPoly
					? { relationTo: item.relationTo, value: item.value.id as string | number }
					: (item.value.id as string | number)
			)
			const normalizedExisting = Array.isArray(value) ? value.map(normalizeValue) : []
			onChange([...normalizedExisting, ...newValues])
		},
		[populateDocs, value, normalizeValue, onChange, relationTo]
	)

	// Called from FolderPickerDrawer when hasMany=false (single pick)
	const onPickerSelect = React.useCallback(
		async ({
			collectionSlug: slug,
			doc,
		}: {
			collectionSlug: string
			doc: { id: string | number }
		}) => {
			const isPoly = Array.isArray(relationTo)
			const loadedDocs = await populateDocs([{ relationTo: slug, value: doc.id }])
			const selectedDoc = loadedDocs?.[0] || null

			setPopulatedDocs((curr) => {
				if (selectedDoc) {
					if (hasMany) return [...(curr || []), selectedDoc]
					return [selectedDoc]
				}
				return curr
			})

			if (hasMany) {
				const newValue = isPoly ? { relationTo: slug, value: doc.id } : doc.id
				const normalizedExisting = Array.isArray(value) ? value.map(normalizeValue) : []
				onChange([...normalizedExisting, newValue])
			} else {
				onChange(isPoly ? { relationTo: slug, value: doc.id } : doc.id)
			}
		},
		[hasMany, populateDocs, onChange, value, relationTo, normalizeValue]
	)

	const onSwitchToListView = useCallback(() => {
		closePickerDrawer()
		openListDrawer()
	}, [closePickerDrawer, openListDrawer])

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onListSelect = useCallback(
		async ({ collectionSlug, doc }: { collectionSlug: string; doc: any }) => {
			await onPickerSelect({ collectionSlug, doc: { id: doc.id } })
			closeListDrawer()
		},
		[onPickerSelect, closeListDrawer]
	)

	const onListBulkSelect = useCallback<NonNullable<ListDrawerProps['onBulkSelect']>>(
		async (selected) => {
			const selectedDocIDs: (string | number)[] = []
			for (const [id, isSelected] of selected) {
				if (isSelected) selectedDocIDs.push(id)
			}
			if (selectedDocIDs.length === 0) {
				closeListDrawer()
				return
			}
			const isPoly = Array.isArray(relationTo)
			const itemsToLoad = selectedDocIDs.map((id) => ({
				relationTo: activeRelationTo,
				value: id as string | number,
			}))
			const loadedDocs = await populateDocs(itemsToLoad)
			if (loadedDocs?.length) {
				setPopulatedDocs((curr) => [...(curr || []), ...loadedDocs])
			}
			const newValues = selectedDocIDs.map((id) =>
				isPoly ? { relationTo: activeRelationTo, value: id as string | number } : id
			)
			const normalizedExisting = Array.isArray(value) ? value.map(normalizeValue) : []
			onChange([...normalizedExisting, ...newValues])
			closeListDrawer()
		},
		[activeRelationTo, closeListDrawer, onChange, populateDocs, value, relationTo, normalizeValue]
	)

	const onDocCreate = React.useCallback(
		(data: { doc?: Record<string, unknown> }) => {
			const isPoly = Array.isArray(relationTo)
			if (data.doc) {
				setPopulatedDocs((curr) => [
					...(curr || []),
					{ relationTo: activeRelationTo, value: data.doc as JsonObject },
				])
				const newValue = isPoly ? { relationTo: activeRelationTo, value: data.doc.id } : data.doc.id
				onChange(newValue)
			}
			closeCreateDocDrawer()
		},
		[closeCreateDocDrawer, activeRelationTo, onChange, relationTo]
	)

	const onReorder = React.useCallback(
		(newValue: { relationTo: string; value: { id: string | number } }[]) => {
			const isPoly = Array.isArray(relationTo)
			const newValueToSave = newValue.map(({ relationTo: rel, value }) =>
				isPoly ? { relationTo: rel, value: value.id } : value.id
			)
			onChange(newValueToSave)
			setPopulatedDocs(newValue)
		},
		[onChange, relationTo]
	)

	const onRemove = React.useCallback(
		(newValue?: PopulatedDocs) => {
			const isPoly = Array.isArray(relationTo)
			if (!newValue || newValue.length === 0) {
				onChange(hasMany ? [] : null)
				setPopulatedDocs(hasMany ? [] : undefined)
				return
			}
			const newValueToSave = newValue.map(({ relationTo: rel, value }) =>
				isPoly ? { relationTo: rel, value: value.id } : value.id
			)
			onChange(hasMany ? newValueToSave : newValueToSave[0])
			setPopulatedDocs(newValue)
		},
		[onChange, hasMany, relationTo]
	)

	const reloadDoc = React.useCallback<ReloadDoc>(
		async (docID, collectionSlug) => {
			const docs = await populateDocs([{ relationTo: collectionSlug, value: docID }])
			if (docs[0]) {
				let updatedDocs: PopulatedDocs = []
				setPopulatedDocs((curr) => {
					const idx =
						curr?.findIndex(
							(d) =>
								(d.value?.id === docs[0]?.value.id || d.value?.isPlaceholder) &&
								d.relationTo === collectionSlug
						) ?? -1
					if (idx > -1) {
						const updated = [...(curr || [])]
						updated[idx] = docs[0] as PopulatedDocs[number]
						updatedDocs = updated
						return updated
					}
					return curr
				})
				if (updatedDocs.length && hasMany) {
					onChange(updatedDocs.map((d) => d.value?.id))
				}
			}
		},
		[populateDocs, onChange, hasMany]
	)

	// Initial population
	useEffect(() => {
		async function loadInitialDocs() {
			if (value) {
				let itemsToLoad: ValueWithRelation[] = []
				if (
					Array.isArray(relationTo) &&
					((typeof value === 'object' && 'relationTo' in value) ||
						(Array.isArray(value) &&
							value.length > 0 &&
							typeof value[0] === 'object' &&
							'relationTo' in value[0]))
				) {
					const values = Array.isArray(value) ? value : [value]
					itemsToLoad = values
						.filter((v): v is ValueWithRelation => typeof v === 'object' && 'relationTo' in v)
						.map((v) => {
							let idValue: any = v.value
							while (idValue && typeof idValue === 'object' && 'value' in idValue)
								idValue = idValue.value
							return { relationTo: v.relationTo, value: idValue as number | string }
						})
				} else if (!Array.isArray(relationTo)) {
					const ids = Array.isArray(value) ? value : [value]
					itemsToLoad = ids.map((id): ValueWithRelation => {
						let idValue: any = id
						while (idValue && typeof idValue === 'object' && 'value' in idValue)
							idValue = idValue.value
						return { relationTo, value: idValue as number | string }
					})
				}
				if (itemsToLoad.length > 0) {
					const loadedDocs = await populateDocs(itemsToLoad)
					if (loadedDocs) {
						setPopulatedDocs(loadedDocs)
						loadedValueRef.current = value
					}
				}
			} else {
				setPopulatedDocs([])
				loadedValueRef.current = null
			}
		}
		if (loadedValueRef.current !== value) void loadInitialDocs()
	}, [populateDocs, value, relationTo])

	//biome-ignore lint/correctness/useExhaustiveDependencies: Not sure, but this was copied from payload own upload input
	useEffect(() => {
		setOnSuccess(onUploadSuccess)
	}, [value, path, onUploadSuccess, setOnSuccess])

	const showDropzone =
		!value ||
		(hasMany && Array.isArray(value) && (typeof maxRows !== 'number' || value.length < maxRows)) ||
		(!hasMany && populatedDocs?.[0] && typeof populatedDocs[0].value === 'undefined')

	return (
		<div
			className={[
				fieldBaseClass,
				baseClass,
				className,
				showError && 'error',
				readOnly && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			id={`field-${path?.replace(/\./g, '__')}`}
			style={style}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel label={label} localized={localized} path={path} required={required} />
				}
			/>
			<div className={`${baseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
			</div>
			{BeforeInput}
			<div className={`${baseClass}__dropzoneAndUpload`}>
				{hasMany && Array.isArray(value) && value.length > 0 ? (
					<>
						{populatedDocs && populatedDocs.length > 0 ? (
							<UploadComponentHasMany
								displayPreview={displayPreview}
								fileDocs={populatedDocs}
								isSortable={isSortable && !readOnly}
								onRemove={onRemove}
								onReorder={onReorder}
								readonly={readOnly}
								reloadDoc={reloadDoc}
								serverURL={serverURL ?? ''}
								showCollectionSlug={Array.isArray(relationTo)}
							/>
						) : (
							<div className={`${baseClass}__loadingRows`}>
								{(value as any[]).map((id) => (
									<ShimmerEffect height="40px" key={typeof id === 'object' ? id.value : id} />
								))}
							</div>
						)}
					</>
				) : null}
				{!hasMany && value ? (
					<>
						{populatedDocs && populatedDocs.length > 0 && populatedDocs[0]?.value ? (
							<UploadComponentHasOne
								displayPreview={displayPreview}
								fileDoc={populatedDocs[0]}
								onRemove={onRemove}
								readonly={readOnly}
								reloadDoc={reloadDoc}
								serverURL={serverURL ?? ''}
								showCollectionSlug={Array.isArray(relationTo)}
							/>
						) : populatedDocs && value && !populatedDocs?.[0]?.value ? (
							<>
								{t('general:untitled')} - ID: {value}
							</>
						) : (
							<ShimmerEffect height="62px" />
						)}
					</>
				) : null}
				{showDropzone ? (
					<Dropzone
						disabled={readOnly || !canCreate}
						multipleFiles={hasMany}
						onChange={onLocalFileSelection}
					>
						<div className={`${baseClass}__dropzoneContent`}>
							<div className={`${baseClass}__dropzoneContent__buttons`}>
								{canCreate && (
									<>
										<Button
											buttonStyle="pill"
											className={`${baseClass}__createNewToggler`}
											disabled={readOnly || !canCreate}
											onClick={() => {
												if (!readOnly) {
													if (hasMany) onLocalFileSelection()
													else openCreateDocDrawer()
												}
											}}
											size="small"
										>
											{t('general:createNew')}
										</Button>
										<span className={`${baseClass}__dropzoneContent__orText`}>
											{t('general:or')}
										</span>
									</>
								)}
								<Button
									buttonStyle="pill"
									className={`${baseClass}__listToggler`}
									disabled={readOnly}
									onClick={openPickerDrawer}
									size="small"
								>
									{t('fields:chooseFromExisting')}
								</Button>
								<CreateDocDrawer onSave={onDocCreate} />
								<FolderPickerDrawer
									allowCreate={canCreate}
									onBulkSelect={onPickerBulkSelect}
									onSelect={onPickerSelect}
									onSwitchToListView={onSwitchToListView}
								/>
								<ListDrawer
									allowCreate={canCreate}
									enableRowSelections={hasMany}
									onBulkSelect={onListBulkSelect}
									onSelect={onListSelect}
								/>
							</div>
							{canCreate && !readOnly && (
								<p className={`${baseClass}__dragAndDropText`}>
									{t('general:or')} {t('upload:dragAndDrop')}
								</p>
							)}
						</div>
					</Dropzone>
				) : (
					<>
						{!readOnly &&
						!populatedDocs &&
						(!value ||
							typeof maxRows !== 'number' ||
							(Array.isArray(value) && value.length < maxRows)) ? (
							<ShimmerEffect height="40px" />
						) : null}
					</>
				)}
			</div>
			{AfterInput}
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={description} path={path} />}
			/>
		</div>
	)
}
