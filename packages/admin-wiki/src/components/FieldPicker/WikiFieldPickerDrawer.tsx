'use client'

import {
	BlocksDrawer,
	Button,
	DocumentFields,
	Drawer,
	EditDepthProvider,
	Form,
	OperationProvider,
	ReactSelect,
	type ReactSelectOption,
	ShimmerEffect,
	useConfig,
	useDrawerSlug,
	useLocale,
	useModal,
	useServerFunctions,
} from '@payloadcms/ui'
import type { ClientBlock, ClientField, FormState, SanitizedDocumentPermissions } from 'payload'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { resolveClientLabel } from '../TargetSelect/clientBlocks'
import { collectBlockUsages, type WikiBlockUsage } from './blockUsages'
import { buildPrefillData } from './buildPrefillData'
import { toggleFieldTarget } from './fieldTargetGroups'
import { WikiFieldPickerProvider } from './WikiPickerContext'
import './field-picker.css'

/** Which kind of thing this drawer picks fields from. One drawer per kind. */
export type WikiFieldPickerKind = 'block' | 'collection' | 'global'

/**
 * What the drawer is showing, as one string. Deliberately the same grammar the
 * stored targets are rooted at (`collection:posts`, `block:heroBanner`), so a
 * group in the field list can hand its own id straight to the drawer.
 */
type PickerSelection = string

/** One form to build and render, whichever kind of thing was selected. */
type ResolvedTarget = {
	/** The entity to build state against: a block borrows the one it renders in. */
	entityKind: 'collection' | 'global'
	entitySlug: string
	fields: ClientField[]
	/** Key into the field schema map, and the schema path the fields render under. */
	schemaPath: string
}

/**
 * Every field readable, which is what the picker needs: it renders the form to
 * be read and pointed at, never to be written, and a field the reader cannot
 * read is dropped by `RenderFields` before it can be offered as a target.
 *
 * The real per-document permissions are not available here and would be the
 * wrong question anyway: they answer whether *this* reader may edit *that*
 * document, where a guide is attached to a schema path rather than to any
 * document at all.
 */
const PICKER_PERMISSIONS: SanitizedDocumentPermissions = { fields: true }

export type WikiFieldPickerDrawerProps = {
	/** Covered block slugs, in display order. */
	blockSlugs: string[]
	/**
	 * The renderable block usages, when the caller already walked the config for
	 * them. Walked here when omitted.
	 */
	blockUsages?: Map<string, WikiBlockUsage>
	/** Covered collection slugs, in display order. */
	collectionSlugs: string[]
	/** Covered global slugs, in display order. */
	globalSlugs: string[]
	/** What to open on, as `collection:posts` or `block:hero`; must match `kind`. */
	initialSelection?: string
	kind: WikiFieldPickerKind
	/** Called with the full new target list when the author confirms. */
	onConfirm: (next: string[]) => void
	/** Modal slug the drawer is registered under (from `useDrawerSlug`). */
	slug: string
	/** The guide's stored field targets, which the working list starts from. */
	value: string[]
}

type LoadState = 'empty' | 'error' | 'loading' | 'ready'

/**
 * The field picker: the host's own fields, rendered for real, with a select
 * plate on each one.
 *
 * It is not a document view and not a `DocumentDrawer`. The form is built by
 * calling Payload's `form-state` server function directly and mounting `<Form
 * initialState>` around `<DocumentFields>`, which is what makes this safe: no
 * document controls means no save and no autosave, no `returnLockStatus` means
 * no lock row (which would otherwise be created for globals), and with no `id`
 * there is nothing to write to. Every request is a read.
 *
 * Rendering the real fields rather than a schema tree is the point. An author
 * recognises the form they were just looking at, including their own custom
 * field components, their labels in their language, and their layout; a list of
 * `branding.color` strings is a different skill. `DocumentFields` is what buys
 * the last of those: it is the edit view's own layout component, so a sidebar
 * field lands in a sidebar here too instead of in the middle of the main column,
 * and the split keeps a null in each column for the other's fields, which is how
 * the index paths the schema paths are computed from stay untouched.
 *
 * One drawer per kind. The kind is chosen before the drawer opens, from the menu
 * on the field's button, so the drawer carries exactly one control: switch to
 * another collection, another global, or another block, never across. A block is
 * shown the same way an entity is, because after block-scoping a field inside a
 * block is a target in its own right rather than one per usage. The only
 * asymmetry is invisible to the author: a block's fields are keyed in the schema
 * map per usage, so the drawer borrows one usage's path and the entity that owns
 * it (see `collectBlockUsages`) and hands both to the same request.
 *
 * Arrays are seeded with one empty row each (see `buildPrefillData`), so their
 * interiors are clickable. Blocks fields are deliberately left empty: their
 * interiors are reached by picking the block itself, which is one form instead
 * of every allowed block's form at once. What stays out of reach is a field
 * hidden by a condition that is false on empty data, since conditions are
 * evaluated server-side while state is built and a failing field is never
 * rendered at all; the path input under the field target list covers it.
 */
export const WikiFieldPickerDrawer = ({
	blockSlugs,
	blockUsages: usagesFromProps,
	collectionSlugs,
	globalSlugs,
	initialSelection,
	kind,
	onConfirm,
	slug,
	value,
}: WikiFieldPickerDrawerProps) => {
	const { i18n, t } = useTranslation()
	const { config, getEntityConfig } = useConfig()
	const { closeModal, modalState, openModal } = useModal()
	const { getFormState } = useServerFunctions()
	const { code: locale } = useLocale()
	const blocksDrawerSlug = useDrawerSlug('wiki-field-picker-blocks')

	const isOpen = Boolean(modalState[slug]?.isOpen)
	const wasOpen = useRef(false)

	const isBlockPicker = kind === 'block'

	/** A block has no default: the grid is the way in, and it opens on its own. */
	const fallbackSelection = useMemo<string | undefined>(() => {
		if (isBlockPicker) {
			return undefined
		}
		const slugs = kind === 'collection' ? collectionSlugs : globalSlugs
		return slugs[0] ? `${kind}:${slugs[0]}` : undefined
	}, [collectionSlugs, globalSlugs, isBlockPicker, kind])

	const [selection, setSelection] = useState<PickerSelection | undefined>(fallbackSelection)
	const [working, setWorking] = useState<string[]>(value)
	const [formState, setFormState] = useState<FormState | null>(null)
	const [status, setStatus] = useState<LoadState>('loading')

	/**
	 * Every block the picker can actually render, by slug. Computed from the
	 * client config alone, so it costs one walk per config change and nothing per
	 * selection.
	 */
	const blockUsages = useMemo<Map<string, WikiBlockUsage>>(() => {
		if (!isBlockPicker) {
			return new Map()
		}
		return (
			usagesFromProps ??
			collectBlockUsages(config, { collections: collectionSlugs, globals: globalSlugs })
		)
	}, [collectionSlugs, config, globalSlugs, isBlockPicker, usagesFromProps])

	/**
	 * A covered block with nowhere to render it has no schema path, so it is left
	 * out of the grid rather than offered as a form that cannot be built.
	 */
	const availableBlocks = useMemo<ClientBlock[]>(
		() =>
			blockSlugs.flatMap((blockSlug) => {
				const usage = blockUsages.get(blockSlug)
				return usage ? [usage.block] : []
			}),
		[blockSlugs, blockUsages]
	)

	const browseBlocks = useCallback(() => openModal(blocksDrawerSlug), [blocksDrawerSlug, openModal])

	/**
	 * The working list is seeded on the open transition only. Seeding it from
	 * `value` on every change would undo the author's picks the moment confirming
	 * writes them back, while the drawer is still mounted.
	 */
	useEffect(() => {
		if (isOpen && !wasOpen.current) {
			const next = initialSelection ?? fallbackSelection
			setWorking(value)
			setSelection(next)
			if (isBlockPicker && !next) {
				browseBlocks()
			}
		}
		wasOpen.current = isOpen
	}, [browseBlocks, fallbackSelection, initialSelection, isBlockPicker, isOpen, value])

	const target = useMemo<ResolvedTarget | undefined>(() => {
		if (!selection) {
			return undefined
		}
		const selectedSlug = selection.slice(selection.indexOf(':') + 1)
		if (isBlockPicker) {
			const usage = blockUsages.get(selectedSlug)
			return usage
				? {
						entityKind: usage.entityKind,
						entitySlug: usage.entitySlug,
						fields: usage.block.fields,
						schemaPath: usage.schemaPath,
					}
				: undefined
		}
		const entityKind = kind === 'global' ? 'global' : 'collection'
		const entityConfig =
			entityKind === 'collection'
				? getEntityConfig({ collectionSlug: selectedSlug })
				: getEntityConfig({ globalSlug: selectedSlug })
		return entityConfig
			? {
					entityKind,
					entitySlug: selectedSlug,
					fields: entityConfig.fields,
					schemaPath: selectedSlug,
				}
			: undefined
	}, [blockUsages, getEntityConfig, isBlockPicker, kind, selection])

	useEffect(() => {
		if (!isOpen) {
			return
		}
		if (!selection) {
			setFormState(null)
			setStatus('empty')
			return
		}
		if (!target || target.fields.length === 0) {
			setFormState(null)
			setStatus('error')
			return
		}
		const controller = new AbortController()
		setFormState(null)
		setStatus('loading')
		const entityArgs =
			target.entityKind === 'collection'
				? { collectionSlug: target.entitySlug }
				: { globalSlug: target.entitySlug }
		void getFormState({
			...entityArgs,
			data: buildPrefillData(target.fields),
			docPermissions: undefined,
			docPreferences: { fields: {} },
			locale,
			operation: 'create',
			readOnly: true,
			renderAllFields: true,
			schemaPath: target.schemaPath,
			signal: controller.signal,
			skipValidation: true,
		})
			.then(({ state }) => {
				if (controller.signal.aborted) {
					return
				}
				setFormState(state ?? null)
				setStatus(state ? 'ready' : 'error')
			})
			.catch(() => {
				// Changing the selection aborts the request in flight, which rejects.
				// That is this effect's own doing, not a failure to report.
				if (!controller.signal.aborted) {
					setStatus('error')
				}
			})
		return () => controller.abort()
	}, [getFormState, isOpen, locale, selection, target])

	/** One kind per drawer, so the menu is a flat list rather than groups. */
	const entityOptions = useMemo<ReactSelectOption[]>(() => {
		if (isBlockPicker) {
			return []
		}
		const labels = new Map<string, unknown>(
			kind === 'collection'
				? config.collections.map((collection) => [collection.slug, collection.labels?.singular])
				: config.globals.map((global) => [global.slug, global.label])
		)
		return (kind === 'collection' ? collectionSlugs : globalSlugs).map((entitySlug) => ({
			label: resolveClientLabel(labels.get(entitySlug), i18n.language, entitySlug),
			value: `${kind}:${entitySlug}`,
		}))
	}, [collectionSlugs, config, globalSlugs, i18n.language, isBlockPicker, kind])

	const selectValue = useMemo<null | ReactSelectOption>(() => {
		if (!selection) {
			return null
		}
		if (isBlockPicker) {
			const blockSlug = selection.slice('block:'.length)
			return {
				label: resolveClientLabel(
					blockUsages.get(blockSlug)?.block.labels?.singular,
					i18n.language,
					blockSlug
				),
				value: selection,
			}
		}
		return entityOptions.find((option) => option.value === selection) ?? null
	}, [blockUsages, entityOptions, i18n.language, isBlockPicker, selection])

	const picker = useMemo(
		() => ({
			isSelected: (schemaPath: string) => working.includes(schemaPath),
			toggle: (schemaPath: string) =>
				setWorking((current) => toggleFieldTarget(current, schemaPath)),
		}),
		[working]
	)

	const onEntityChange = useCallback((next: ReactSelectOption | ReactSelectOption[]) => {
		const option = Array.isArray(next) ? next[0] : next
		if (option) {
			setSelection(String(option.value))
		}
	}, [])

	const onBlockSelect = useCallback((_index: number, blockType?: string) => {
		if (blockType) {
			setSelection(`block:${blockType}`)
		}
	}, [])

	const confirm = useCallback(() => {
		onConfirm(working)
		closeModal(slug)
	}, [closeModal, onConfirm, slug, working])

	return (
		<Drawer className="wiki-field-picker-modal" slug={slug} title={t(keys.pickerTitle)}>
			<div className="wiki-field-picker">
				<div className="wiki-field-picker__switcher">
					<div className="wiki-field-picker__source">
						<span className="wiki-field-picker__source-label">{t(keys.pickerEntityLabel)}</span>
						{isBlockPicker ? (
							<ReactSelect
								isClearable={false}
								isMulti={false}
								isSearchable={false}
								menuIsOpen={false}
								onChange={() => undefined}
								onMenuOpen={browseBlocks}
								options={[]}
								placeholder={t(keys.targetBlocksPlaceholder)}
								value={selectValue ?? undefined}
							/>
						) : (
							<ReactSelect
								isClearable={false}
								isMulti={false}
								onChange={onEntityChange}
								options={entityOptions}
								placeholder={t(keys.pickerEntityLabel)}
								value={selectValue ?? undefined}
							/>
						)}
					</div>
				</div>
				<div className="wiki-field-picker__body">
					{status === 'loading' ? (
						<div className="wiki-field-picker__loading">
							<ShimmerEffect height="2rem" />
							<ShimmerEffect height="2rem" width="80%" />
							<ShimmerEffect height="2rem" width="90%" />
						</div>
					) : null}
					{status === 'empty' ? (
						<div className="wiki-field-picker__empty">
							<p className="wiki-field-picker__status">{t(keys.pickerNoBlock)}</p>
							{isBlockPicker ? (
								<Button buttonStyle="secondary" margin={false} onClick={browseBlocks} size="small">
									{t(keys.pickerChooseBlock)}
								</Button>
							) : null}
						</div>
					) : null}
					{status === 'error' ? (
						<p className="wiki-field-picker__status">{t(keys.pickerUnavailable)}</p>
					) : null}
					{status === 'ready' && formState && target ? (
						<WikiFieldPickerProvider value={picker}>
							<EditDepthProvider>
								<OperationProvider operation="create">
									<Form el="div" initialState={formState} key={selection}>
										<DocumentFields
											docPermissions={PICKER_PERMISSIONS}
											fields={target.fields}
											readOnly
											schemaPathSegments={[target.schemaPath]}
										/>
									</Form>
								</OperationProvider>
							</EditDepthProvider>
						</WikiFieldPickerProvider>
					) : null}
				</div>
				<div className="wiki-field-picker__footer">
					<span className="wiki-field-picker__count">
						{t(keys.pickerSelectedCount, { count: working.length })}
					</span>
					<Button buttonStyle="secondary" margin={false} onClick={() => closeModal(slug)}>
						{t(keys.pickerCancel)}
					</Button>
					<Button margin={false} onClick={confirm}>
						{t(keys.pickerConfirm)}
					</Button>
				</div>
			</div>
			{isBlockPicker ? (
				<BlocksDrawer
					addRow={onBlockSelect}
					addRowIndex={0}
					blocks={availableBlocks}
					drawerSlug={blocksDrawerSlug}
					labels={{
						plural: t(keys.targetBlocksLabel),
						singular: t(keys.targetBlocksSingular),
					}}
				/>
			) : null}
		</Drawer>
	)
}
