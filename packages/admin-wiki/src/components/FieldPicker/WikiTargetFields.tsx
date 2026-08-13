'use client'

import {
	Button,
	Collapsible,
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	Pill,
	Popup,
	PopupList,
	RenderCustomComponent,
	useConfig,
	useDrawerSlug,
	useField,
	useModal,
	XIcon,
} from '@payloadcms/ui'
import type { ClientBlock, ClientField, TextFieldClientProps } from 'payload'
import { useCallback, useMemo, useState } from 'react'

import { keys, type TranslationKey } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { collectClientBlocks, registryBlock } from '../TargetSelect/clientBlocks'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import { collectBlockUsages } from './blockUsages'
import { resolveFieldPathCrumbs } from './fieldPathLabels'
import { addFieldTarget, groupFieldTargets, type WikiFieldTargetGroup } from './fieldTargetGroups'
import { WikiFieldPickerDrawer, type WikiFieldPickerKind } from './WikiFieldPickerDrawer'
import './field-picker.css'

/** Above this, a group is collapsed until the author asks for it. */
const COLLAPSE_THRESHOLD = 5

/** What a group is rooted at, said in words rather than in an icon. */
const KIND_KEYS: Record<WikiFieldTargetGroup['kind'], TranslationKey> = {
	block: keys.targetBlocksSingular,
	collection: keys.targetFieldsKindCollection,
	global: keys.targetFieldsKindGlobal,
	unresolved: keys.targetFieldsUnresolved,
}

/**
 * The way into the picker: one drawer per kind, so the kind is chosen before the
 * drawer opens rather than switched inside it. With one kind covered there is
 * nothing to choose, and the menu collapses to a plain button.
 */
const WikiPickFieldsButton = ({
	kinds,
	label,
	onPick,
	optionLabel,
}: {
	kinds: WikiFieldPickerKind[]
	label: string
	onPick: (kind: WikiFieldPickerKind) => void
	optionLabel: (kind: WikiFieldPickerKind) => string
}) => {
	const [only] = kinds

	if (!only) {
		return null
	}

	if (kinds.length === 1) {
		return (
			<Button
				className="wiki-target-fields__open"
				margin={false}
				onClick={() => onPick(only)}
				size="small"
			>
				{label}
			</Button>
		)
	}

	return (
		<Popup
			button={
				<Button className="wiki-target-fields__open" margin={false} size="small">
					{label}
				</Button>
			}
			buttonType="custom"
			horizontalAlign="right"
			render={({ close }) => (
				<PopupList.ButtonGroup>
					{kinds.map((kind) => (
						<PopupList.Button
							key={kind}
							onClick={() => {
								close()
								onPick(kind)
							}}
						>
							{optionLabel(kind)}
						</PopupList.Button>
					))}
				</PopupList.ButtonGroup>
			)}
			size="medium"
		/>
	)
}

export type WikiTargetFieldsProps = {
	/** Injected client prop: the block slugs the plugin covers. */
	blockSlugs: string[]
	/** Injected client prop: the collection slugs the plugin covers. */
	collectionSlugs: string[]
	/** Injected client prop: the global slugs the plugin covers. */
	globalSlugs: string[]
} & TextFieldClientProps

/**
 * The field target list, grouped by what each target is rooted at.
 *
 * A guide that documents a form carries dozens of these, spread over
 * collections, globals, and blocks at once, so a flat list of chips stops being
 * readable exactly when it starts mattering. One section per owner, with a
 * count and the paths underneath, answers "what does this guide cover" without
 * reading a single prefix; large sections start collapsed so the tab stays
 * short.
 *
 * Two ways in: the picker drawer, which renders the owner's real fields, and a
 * text input for the paths the picker cannot reach (fields behind a condition,
 * fields inside blocks, fields not built yet). Storage is unchanged either way:
 * `text` with `hasMany`, holding owner-qualified schema paths, so a target whose
 * surface has left the config stays visible under `Unresolved` and removable.
 */
export const WikiTargetFields = ({
	blockSlugs,
	collectionSlugs,
	field,
	globalSlugs,
	path: pathFromProps,
	readOnly,
}: WikiTargetFieldsProps) => {
	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const { blockLabels } = useWikiTargets()
	const { openModal } = useModal()
	const blockDrawerSlug = useDrawerSlug('wiki-field-picker-block')
	const collectionDrawerSlug = useDrawerSlug('wiki-field-picker-collection')
	const globalDrawerSlug = useDrawerSlug('wiki-field-picker-global')

	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string[]>({ potentiallyStalePath: pathFromProps })

	const isReadOnly = Boolean(readOnly) || disabled
	const values = useMemo(() => value ?? [], [value])
	const [draft, setDraft] = useState('')
	const [pickerSelection, setPickerSelection] = useState<string | undefined>(undefined)

	/**
	 * The field list each group's paths are resolved against. Blocks are reached
	 * through the same walk the Blocks picker uses, so a block declared inline on
	 * a field resolves as well as one from the registry.
	 */
	const ownerFields = useMemo(() => {
		const blocks = new Map<string, ClientBlock>()
		for (const collection of config.collections) {
			collectClientBlocks(collection.fields, blocks, config.blocksMap)
		}
		for (const global of config.globals) {
			collectClientBlocks(global.fields, blocks, config.blocksMap)
		}
		return (group: WikiFieldTargetGroup): ClientField[] | undefined => {
			switch (group.kind) {
				case 'block':
					return (blocks.get(group.slug) ?? registryBlock(config.blocksMap, group.slug))?.fields
				case 'collection':
					return config.collections.find((entity) => entity.slug === group.slug)?.fields
				case 'global':
					return config.globals.find((entity) => entity.slug === group.slug)?.fields
				default:
					return undefined
			}
		}
	}, [config])

	const groups = useMemo(
		() =>
			groupFieldTargets(
				values,
				{ blockLabels, collections: config.collections, globals: config.globals },
				{ blocks: blockSlugs, collections: collectionSlugs, globals: globalSlugs }
			).map((group) => {
				const fields = ownerFields(group)
				return {
					...group,
					targets: group.targets.map((target) => ({
						...target,
						crumbs: resolveFieldPathCrumbs(target.label, fields, i18n.language),
					})),
				}
			}),
		[
			blockLabels,
			blockSlugs,
			collectionSlugs,
			config,
			globalSlugs,
			i18n.language,
			ownerFields,
			values,
		]
	)

	const remove = useCallback(
		(target: string) => {
			if (!isReadOnly) {
				setValue(values.filter((candidate) => candidate !== target))
			}
		},
		[isReadOnly, setValue, values]
	)

	const addDraft = useCallback(() => {
		const trimmed = draft.trim()
		if (isReadOnly || trimmed.length === 0) {
			return
		}
		setValue(addFieldTarget(values, trimmed))
		setDraft('')
	}, [draft, isReadOnly, setValue, values])

	const drawerSlugs = useMemo<Record<WikiFieldPickerKind, string>>(
		() => ({
			block: blockDrawerSlug,
			collection: collectionDrawerSlug,
			global: globalDrawerSlug,
		}),
		[blockDrawerSlug, collectionDrawerSlug, globalDrawerSlug]
	)

	/**
	 * A block that renders nowhere has no schema path, so it cannot be a source.
	 * Walked here rather than in the drawer so the menu offers Blocks only when
	 * one is actually pickable, and the drawer reuses the same result.
	 */
	const blockUsages = useMemo(
		() => collectBlockUsages(config, { collections: collectionSlugs, globals: globalSlugs }),
		[collectionSlugs, config, globalSlugs]
	)

	/** The kinds worth offering: a menu of one is a button. */
	const availableKinds = useMemo<WikiFieldPickerKind[]>(() => {
		const kinds: WikiFieldPickerKind[] = []
		if (collectionSlugs.length > 0) {
			kinds.push('collection')
		}
		if (globalSlugs.length > 0) {
			kinds.push('global')
		}
		if (blockSlugs.some((blockSlug) => blockUsages.has(blockSlug))) {
			kinds.push('block')
		}
		return kinds
	}, [blockSlugs, blockUsages, collectionSlugs, globalSlugs])

	const openPicker = useCallback(
		(pickerKind: WikiFieldPickerKind, selection?: string) => {
			setPickerSelection(selection)
			openModal(drawerSlugs[pickerKind])
		},
		[drawerSlugs, openModal]
	)

	return (
		<div
			className={[
				fieldBaseClass,
				'wiki-target-fields',
				showError && 'error',
				isReadOnly && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			id={`field-${path.replace(/\./g, '__')}`}
		>
			{/* Label on the left, the way in on the right: the same header shape a
			    join field uses, so the button reads as belonging to this list rather
			    than to whatever follows it. */}
			<div className="wiki-target-fields__header">
				<RenderCustomComponent
					CustomComponent={Label}
					Fallback={<FieldLabel label={field?.label} path={path} />}
				/>
				{isReadOnly ? null : (
					<WikiPickFieldsButton
						kinds={availableKinds}
						label={t(keys.pickerOpen)}
						onPick={openPicker}
						optionLabel={(pickerKind) => t(KIND_KEYS[pickerKind])}
					/>
				)}
			</div>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				{groups.length === 0 ? (
					<p className="wiki-target-fields__empty">{t(keys.targetFieldsEmpty)}</p>
				) : (
					<ul className="wiki-target-fields__groups">
						{groups.map((group) => {
							/** A group is editable when its own kind has a drawer to open. */
							const editKind =
								!isReadOnly && group.kind !== 'unresolved' && availableKinds.includes(group.kind)
									? group.kind
									: undefined
							return (
								<li className="wiki-target-fields__group" key={group.id}>
									<Collapsible
										actions={
											editKind ? (
												<Button
													buttonStyle="subtle"
													className="wiki-target-fields__group-edit"
													margin={false}
													onClick={() => openPicker(editKind, group.id)}
													size="small"
												>
													{t(keys.pickerEdit)}
												</Button>
											) : undefined
										}
										header={
											<div className="wiki-target-fields__group-header">
												<Pill
													className="wiki-target-fields__group-kind"
													pillStyle={group.kind === 'unresolved' ? 'warning' : 'white'}
													size="small"
												>
													{t(KIND_KEYS[group.kind])}
												</Pill>
												{group.kind === 'unresolved' ? null : (
													<span className="wiki-target-fields__group-label">{group.label}</span>
												)}
												<Pill
													className="wiki-target-fields__group-count"
													pillStyle="light-gray"
													size="small"
												>
													{group.targets.length}
												</Pill>
											</div>
										}
										initCollapsed={group.targets.length > COLLAPSE_THRESHOLD}
									>
										<ul className="wiki-target-fields__paths">
											{group.targets.map((target) => (
												<li className="wiki-target-fields__path" key={target.value}>
													{target.crumbs.length > 0 ? (
														<span className="wiki-target-fields__crumbs" title={target.value}>
															{target.crumbs.map((crumb, index) => (
																<span
																	className={[
																		'wiki-target-fields__crumb',
																		index === target.crumbs.length - 1 &&
																			'wiki-target-fields__crumb--leaf',
																	]
																		.filter(Boolean)
																		.join(' ')}
																	key={target.crumbs.slice(0, index + 1).join('›')}
																>
																	{crumb}
																</span>
															))}
														</span>
													) : (
														<code className="wiki-target-fields__raw" title={target.value}>
															{target.label}
														</code>
													)}
													{isReadOnly ? null : (
														<button
															aria-label={t(keys.targetFieldsRemove, { path: target.value })}
															className="wiki-target-fields__remove"
															onClick={() => remove(target.value)}
															type="button"
														>
															<XIcon />
														</button>
													)}
												</li>
											))}
										</ul>
									</Collapsible>
								</li>
							)
						})}
					</ul>
				)}
				{isReadOnly ? null : (
					<div className="wiki-target-fields__manual">
						{/* `field-type text` is Payload's own input skin, so the manual path
						    matches every other text input in the form, theming included. */}
						<div className="wiki-target-fields__manual-input field-type text">
							<input
								aria-label={t(keys.targetFieldsManualLabel)}
								onChange={(event) => setDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault()
										addDraft()
									}
								}}
								placeholder={t(keys.targetFieldsManualPlaceholder)}
								type="text"
								value={draft}
							/>
						</div>
						<Button
							buttonStyle="secondary"
							disabled={draft.trim().length === 0}
							margin={false}
							onClick={addDraft}
						>
							{t(keys.targetFieldsManualAdd)}
						</Button>
					</div>
				)}
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={field?.admin?.description} path={path} />}
			/>
			{isReadOnly
				? null
				: availableKinds.map((availableKind) => (
						<WikiFieldPickerDrawer
							blockSlugs={blockSlugs}
							blockUsages={blockUsages}
							collectionSlugs={collectionSlugs}
							globalSlugs={globalSlugs}
							initialSelection={
								pickerSelection?.startsWith(`${availableKind}:`) ? pickerSelection : undefined
							}
							key={availableKind}
							kind={availableKind}
							onConfirm={setValue}
							slug={drawerSlugs[availableKind]}
							value={values}
						/>
					))}
		</div>
	)
}
