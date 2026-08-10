'use client'

import {
	BlocksDrawer,
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	ReactSelect,
	type ReactSelectOption,
	RenderCustomComponent,
	useConfig,
	useDrawerSlug,
	useField,
	useModal,
} from '@payloadcms/ui'
import type { ClientBlock, TextFieldClientProps } from 'payload'
import { useCallback, useMemo } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { collectClientBlocks, resolveClientLabel } from './clientBlocks'

export type WikiTargetBlocksProps = {
	/**
	 * Injected client prop: the block slugs the plugin covers, in display order
	 * and already free of everything the host excluded.
	 */
	slugs: string[]
} & TextFieldClientProps

/**
 * The block target list: a select-shaped control whose chips are the chosen
 * blocks, and whose menu is Payload's own block drawer rather than a dropdown.
 *
 * The drawer is what a block picker looks like everywhere else in the admin,
 * thumbnails, groups, and search included, and it is the only picker that can
 * show a block's label in the reader's language. A plain text input could do
 * none of that, and let an author type a slug that means nothing.
 *
 * Storage is unchanged: `text` with `hasMany`, holding raw slugs. A block that
 * has since left the config still shows here, under its slug, and is still
 * removable.
 */
export const WikiTargetBlocks = ({
	field,
	path: pathFromProps,
	readOnly,
	slugs,
}: WikiTargetBlocksProps) => {
	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const { openModal } = useModal()
	const drawerSlug = useDrawerSlug('wiki-target-blocks')

	const covered = useMemo<ClientBlock[]>(() => {
		const found = new Map<string, ClientBlock>()
		for (const collection of config.collections) {
			collectClientBlocks(collection.fields, found, config.blocksMap)
		}
		for (const global of config.globals) {
			collectClientBlocks(global.fields, found, config.blocksMap)
		}
		return slugs.flatMap((slug) => {
			const block = found.get(slug) ?? config.blocksMap[slug]
			return block ? [block] : []
		})
	}, [config, slugs])

	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string[]>({ potentiallyStalePath: pathFromProps })

	const isReadOnly = Boolean(readOnly) || disabled
	const selectedSlugs = useMemo(() => value ?? [], [value])

	const selected = useMemo<ReactSelectOption[]>(
		() =>
			selectedSlugs.map((slug) => {
				const block = covered.find((candidate) => candidate.slug === slug)
				return {
					label: resolveClientLabel(block?.labels?.singular, i18n.language, slug),
					value: slug,
				}
			}),
		[covered, i18n.language, selectedSlugs]
	)

	/** Only the blocks still on offer: a picker that lists what is already picked. */
	const available = useMemo(
		() => covered.filter((block) => !selectedSlugs.includes(block.slug)),
		[covered, selectedSlugs]
	)

	const onChange = useCallback(
		(next: ReactSelectOption | ReactSelectOption[]) => {
			if (isReadOnly) {
				return
			}
			setValue(Array.isArray(next) ? next.map((option) => String(option.value)) : [])
		},
		[isReadOnly, setValue]
	)

	const addBlock = useCallback(
		(_index: number, blockType?: string) => {
			if (isReadOnly || !blockType || selectedSlugs.includes(blockType)) {
				return
			}
			setValue([...selectedSlugs, blockType])
		},
		[isReadOnly, selectedSlugs, setValue]
	)

	const openDrawer = useCallback(() => {
		if (!isReadOnly) {
			openModal(drawerSlug)
		}
	}, [drawerSlug, isReadOnly, openModal])

	return (
		<div
			className={[fieldBaseClass, 'select', showError && 'error', isReadOnly && 'read-only']
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
				<ReactSelect
					disabled={isReadOnly}
					isClearable
					isMulti
					isSearchable={false}
					isSortable={false}
					menuIsOpen={false}
					onChange={onChange}
					onMenuOpen={openDrawer}
					options={[]}
					placeholder={t(keys.targetBlocksPlaceholder)}
					showError={showError}
					value={selected}
				/>
				{isReadOnly ? null : (
					<BlocksDrawer
						addRow={addBlock}
						addRowIndex={selectedSlugs.length}
						blocks={available}
						drawerSlug={drawerSlug}
						labels={{
							plural: t(keys.targetBlocksLabel),
							singular: t(keys.targetBlocksSingular),
						}}
					/>
				)}
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={field?.admin?.description} path={path} />}
			/>
		</div>
	)
}
