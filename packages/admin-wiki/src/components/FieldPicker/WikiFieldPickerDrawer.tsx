'use client'

import {
	BlocksDrawer,
	Button,
	Drawer,
	EditDepthProvider,
	Form,
	OperationProvider,
	ReactSelect,
	type ReactSelectOption,
	RenderFields,
	ShimmerEffect,
	useConfig,
	useDrawerSlug,
	useLocale,
	useModal,
	useServerFunctions,
} from '@payloadcms/ui'
import type { ClientBlock, ClientField, FormState } from 'payload'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { resolveClientLabel } from '../TargetSelect/clientBlocks'
import { collectBlockUsages } from './blockUsages'
import { buildPrefillData } from './buildPrefillData'
import { toggleFieldTarget } from './fieldTargetGroups'
import { WikiFieldPickerProvider } from './WikiPickerContext'
import './field-picker.css'

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
	/** Key into the field schema map, and `parentSchemaPath` for `RenderFields`. */
	schemaPath: string
}

const splitSelection = (selection: string): { kind: string; slug: string } => {
	const separator = selection.indexOf(':')
	return { kind: selection.slice(0, separator), slug: selection.slice(separator + 1) }
}

export type WikiFieldPickerDrawerProps = {
	/** Covered block slugs, in display order. */
	blockSlugs: string[]
	/** Covered collection slugs, in display order. */
	collectionSlugs: string[]
	/** Covered global slugs, in display order. */
	globalSlugs: string[]
	/** What to open on, as `collection:posts` or `block:hero`; defaults to the first covered. */
	initialSelection?: string
	/** Called with the full new target list when the author confirms. */
	onConfirm: (next: string[]) => void
	/** Modal slug the drawer is registered under (from `useDrawerSlug`). */
	slug: string
	/** The guide's stored field targets, which the working list starts from. */
	value: string[]
}

type LoadState = 'error' | 'loading' | 'ready'

/**
 * The field picker: the host's own fields, rendered for real, with a select
 * plate on each one.
 *
 * It is not a document view and not a `DocumentDrawer`. The form is built by
 * calling Payload's `form-state` server function directly and mounting `<Form
 * initialState>` around `<RenderFields>`, which is what makes this safe: no
 * document controls means no save and no autosave, no `returnLockStatus` means
 * no lock row (which would otherwise be created for globals), and with no `id`
 * there is nothing to write to. Every request is a read.
 *
 * Rendering the real fields rather than a schema tree is the point. An author
 * recognises the form they were just looking at, including their own custom
 * field components, their labels in their language, and their layout; a list of
 * `branding.color` strings is a different skill.
 *
 * A block is the third thing that can be shown, and it is shown the same way,
 * because after block-scoping a field inside a block is a target in its own
 * right rather than one per usage. The only asymmetry is invisible to the
 * author: a block's fields are keyed in the schema map per usage, so the drawer
 * borrows one usage's path and the entity that owns it (see `collectBlockUsages`)
 * and hands both to the same request.
 *
 * Arrays are seeded with one empty row each (see `buildPrefillData`), so their
 * interiors are clickable. Blocks fields are deliberately left empty: their
 * interiors are reached by picking the block itself, which is one form instead
 * of every allowed block's form at once. What stays out of reach is a field
 * hidden by a condition that is false on empty data, since conditions are
 * evaluated server-side while state is built and a failing field is never
 * rendered at all; the manual path input beside the picker button covers it.
 */
export const WikiFieldPickerDrawer = ({
	blockSlugs,
	collectionSlugs,
	globalSlugs,
	initialSelection,
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

	const fallbackSelection = useMemo<string | undefined>(() => {
		if (collectionSlugs[0]) {
			return `collection:${collectionSlugs[0]}`
		}
		return globalSlugs[0] ? `global:${globalSlugs[0]}` : undefined
	}, [collectionSlugs, globalSlugs])

	const [selection, setSelection] = useState<PickerSelection | undefined>(fallbackSelection)
	const [working, setWorking] = useState<string[]>(value)
	const [formState, setFormState] = useState<FormState | null>(null)
	const [status, setStatus] = useState<LoadState>('loading')

	/**
	 * The working list is seeded on the open transition only. Seeding it from
	 * `value` on every change would undo the author's picks the moment confirming
	 * writes them back, while the drawer is still mounted.
	 */
	useEffect(() => {
		if (isOpen && !wasOpen.current) {
			setWorking(value)
			setSelection(initialSelection ?? fallbackSelection)
		}
		wasOpen.current = isOpen
	}, [fallbackSelection, initialSelection, isOpen, value])

	/**
	 * Every block the picker can actually render, by slug. Computed from the
	 * client config alone, so it costs one walk per config change and nothing per
	 * selection.
	 */
	const blockUsages = useMemo(
		() => collectBlockUsages(config, { collections: collectionSlugs, globals: globalSlugs }),
		[collectionSlugs, config, globalSlugs]
	)

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

	const target = useMemo<ResolvedTarget | undefined>(() => {
		if (!selection) {
			return undefined
		}
		const { kind, slug: selectedSlug } = splitSelection(selection)
		if (kind === 'block') {
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
	}, [blockUsages, getEntityConfig, selection])

	useEffect(() => {
		if (!isOpen) {
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
		}).then(({ state }) => {
			if (controller.signal.aborted) {
				return
			}
			setFormState(state ?? null)
			setStatus(state ? 'ready' : 'error')
		})
		return () => controller.abort()
	}, [getFormState, isOpen, locale, target])

	const entityOptions = useMemo(() => {
		const group = (
			label: string,
			slugs: string[],
			kind: 'collection' | 'global'
		): { label: string; options: ReactSelectOption[] }[] => {
			if (slugs.length === 0) {
				return []
			}
			const labels = new Map<string, unknown>(
				kind === 'collection'
					? config.collections.map((collection) => [collection.slug, collection.labels?.plural])
					: config.globals.map((global) => [global.slug, global.label])
			)
			return [
				{
					label,
					options: slugs.map((entitySlug) => ({
						label: resolveClientLabel(labels.get(entitySlug), i18n.language, entitySlug),
						value: `${kind}:${entitySlug}`,
					})),
				},
			]
		}
		return [
			...group(t(keys.targetCollectionsLabel), collectionSlugs, 'collection'),
			...group(t(keys.targetGlobalsLabel), globalSlugs, 'global'),
		]
	}, [collectionSlugs, config, globalSlugs, i18n.language, t])

	const entityValue = useMemo(
		() =>
			entityOptions
				.flatMap((entry) => entry.options)
				.find((option) => option.value === selection) ?? null,
		[entityOptions, selection]
	)

	const blockValue = useMemo<null | ReactSelectOption>(() => {
		if (!selection?.startsWith('block:')) {
			return null
		}
		const blockSlug = selection.slice('block:'.length)
		const usage = blockUsages.get(blockSlug)
		return {
			label: resolveClientLabel(usage?.block.labels?.singular, i18n.language, blockSlug),
			value: selection,
		}
	}, [blockUsages, i18n.language, selection])

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
						<ReactSelect
							isClearable={false}
							isMulti={false}
							onChange={onEntityChange}
							options={entityOptions}
							placeholder={t(keys.pickerEntityLabel)}
							value={entityValue ?? undefined}
						/>
					</div>
					{availableBlocks.length > 0 ? (
						<div className="wiki-field-picker__source">
							<span className="wiki-field-picker__source-label">{t(keys.pickerBlockLabel)}</span>
							<ReactSelect
								isClearable={false}
								isMulti={false}
								isSearchable={false}
								menuIsOpen={false}
								onChange={() => undefined}
								onMenuOpen={() => openModal(blocksDrawerSlug)}
								options={[]}
								placeholder={t(keys.targetBlocksPlaceholder)}
								value={blockValue ?? undefined}
							/>
						</div>
					) : null}
				</div>
				<div className="wiki-field-picker__body">
					{status === 'loading' ? (
						<div className="wiki-field-picker__loading">
							<ShimmerEffect height="2rem" />
							<ShimmerEffect height="2rem" width="80%" />
							<ShimmerEffect height="2rem" width="90%" />
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
										<RenderFields
											fields={target.fields}
											parentIndexPath=""
											parentPath=""
											parentSchemaPath={target.schemaPath}
											permissions={true}
											readOnly
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
			{availableBlocks.length > 0 ? (
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
