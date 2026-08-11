'use client'

import {
	Button,
	ChevronIcon,
	DocumentIcon,
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	GearIcon,
	RenderCustomComponent,
	useConfig,
	useDrawerSlug,
	useField,
	useModal,
	XIcon,
} from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { type ReactNode, useCallback, useMemo, useState } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BlockIcon, CalloutIcon } from '../icons'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import { addFieldTarget, groupFieldTargets, type WikiFieldTargetGroup } from './fieldTargetGroups'
import { WikiFieldPickerDrawer } from './WikiFieldPickerDrawer'
import './field-picker.css'

/** Above this, a group is collapsed until the author asks for it. */
const COLLAPSE_THRESHOLD = 5

const GROUP_ICONS: Record<WikiFieldTargetGroup['kind'], ReactNode> = {
	block: <BlockIcon size="small" />,
	collection: <DocumentIcon />,
	global: <GearIcon />,
	unresolved: <CalloutIcon size="small" variant="warning" />,
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
	const { t } = useTranslation()
	const { blockLabels } = useWikiTargets()
	const { openModal } = useModal()
	const drawerSlug = useDrawerSlug('wiki-field-picker')

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
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const [draft, setDraft] = useState('')
	const [pickerSelection, setPickerSelection] = useState<string | undefined>(undefined)

	const groups = useMemo(
		() =>
			groupFieldTargets(
				values,
				{ blockLabels, collections: config.collections, globals: config.globals },
				{ blocks: blockSlugs, collections: collectionSlugs, globals: globalSlugs }
			),
		[blockLabels, blockSlugs, collectionSlugs, config, globalSlugs, values]
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

	const openPicker = useCallback(
		(selection?: string) => {
			setPickerSelection(selection)
			openModal(drawerSlug)
		},
		[drawerSlug, openModal]
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
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={<FieldLabel label={field?.label} path={path} />}
			/>
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
							const open = expanded[group.id] ?? group.targets.length <= COLLAPSE_THRESHOLD
							return (
								<li className="wiki-target-fields__group" key={group.id}>
									<div className="wiki-target-fields__group-header">
										<button
											aria-expanded={open}
											className="wiki-target-fields__group-toggle"
											onClick={() => setExpanded((current) => ({ ...current, [group.id]: !open }))}
											type="button"
										>
											<ChevronIcon direction={open ? 'down' : 'right'} />
											<span aria-hidden="true" className="wiki-target-fields__group-icon">
												{GROUP_ICONS[group.kind]}
											</span>
											<span className="wiki-target-fields__group-label">
												{group.kind === 'unresolved' ? t(keys.targetFieldsUnresolved) : group.label}
											</span>
											{group.kind === 'block' ? (
												<span className="wiki-target-fields__group-kind">
													{t(keys.targetBlocksSingular)}
												</span>
											) : null}
											<span className="wiki-target-fields__group-count">
												{group.targets.length}
											</span>
										</button>
										{!isReadOnly && group.kind !== 'unresolved' ? (
											<Button
												buttonStyle="none"
												className="wiki-target-fields__group-edit"
												margin={false}
												onClick={() => openPicker(group.id)}
											>
												{t(keys.pickerEdit)}
											</Button>
										) : null}
									</div>
									{open ? (
										<ul className="wiki-target-fields__paths">
											{group.targets.map((target) => (
												<li className="wiki-target-fields__path" key={target.value}>
													<code className="wiki-target-fields__path-label">{target.label}</code>
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
									) : null}
								</li>
							)
						})}
					</ul>
				)}
				{isReadOnly ? null : (
					<div className="wiki-target-fields__actions">
						<Button
							buttonStyle="secondary"
							icon="plus"
							iconPosition="left"
							iconStyle="none"
							margin={false}
							onClick={() => openPicker(undefined)}
							size="small"
						>
							{t(keys.pickerOpen)}
						</Button>
						<input
							aria-label={t(keys.targetFieldsManualLabel)}
							className="wiki-target-fields__manual"
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
				)}
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={field?.admin?.description} path={path} />}
			/>
			{isReadOnly ? null : (
				<WikiFieldPickerDrawer
					blockSlugs={blockSlugs}
					collectionSlugs={collectionSlugs}
					globalSlugs={globalSlugs}
					initialSelection={pickerSelection}
					onConfirm={setValue}
					slug={drawerSlug}
					value={values}
				/>
			)}
		</div>
	)
}
