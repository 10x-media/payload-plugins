'use client'

import type { TextNode } from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	useBasicTypeaheadTriggerMatch,
} from '@payloadcms/richtext-lexical/lexical/react/LexicalTypeaheadMenuPlugin'
import { useEffect, useMemo, useState } from 'react'

import { ComposerMenu } from '../Menu'
import { mergeSlashGroups } from '../model'
import { useComposerRuntime } from '../runtime'
import { type ComposerSlashItem, labelOf } from '../types'

export class CommandOption extends MenuOption {
	group: string
	groupKey: string
	item: ComposerSlashItem
	label: string

	constructor(args: { group: string; groupKey: string; item: ComposerSlashItem; label: string }) {
		super(`${args.groupKey}:${args.item.key}`)
		this.group = args.group
		this.groupKey = args.groupKey
		this.item = args.item
		this.label = args.label
	}
}

const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]/g, '')

/**
 * How well a command matches the query, lower is better, or null: the label
 * starting with it, a word of the label starting with it, then the key or a
 * keyword starting with it. Prefixes only: "red" must not find "Numbered".
 */
const score = (option: CommandOption, needle: string): null | number => {
	const label = option.label.toLowerCase()
	if (normalize(label).startsWith(needle)) return 0
	if (label.split(/[\s_-]+/).some((word) => word.startsWith(needle))) return 1
	if (option.item.key.toLowerCase().startsWith(needle)) return 2
	if (option.item.keywords?.some((keyword) => normalize(keyword).startsWith(needle))) return 3
	return null
}

/** Every command in group order with no query; best matches first with one. */
export const rankCommands = <T extends CommandOption>(options: T[], query: string): T[] => {
	const needle = normalize(query)
	if (!needle) return options
	return options
		.map((option, index) => ({ index, option, score: score(option, needle) }))
		.filter((entry): entry is { index: number; option: T; score: number } => entry.score !== null)
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.map(({ option }) => option)
}

/** `/` opens every feature's `/` groups, filtered by what follows it. */
export const SlashMenu = () => {
	const [editor] = useLexicalComposerContext()
	const { features, labels, setOverlay, t } = useComposerRuntime()
	const [query, setQuery] = useState<null | string>(null)
	const trigger = useBasicTypeaheadTriggerMatch('/', { maxLength: 30, minLength: 0 })
	const all = useMemo(
		() =>
			mergeSlashGroups(features).flatMap((group) =>
				group.items.map(
					(item) =>
						new CommandOption({
							group: labelOf(group.label, group.key, { labels, t }),
							groupKey: group.key,
							item,
							label: labelOf(item.label, item.key, { labels, t }),
						})
				)
			),
		[features, labels, t]
	)
	const options = useMemo(() => rankCommands(all, query ?? ''), [all, query])

	useEffect(() => {
		setOverlay('slash', query !== null && options.length > 0)
		return () => setOverlay('slash', false)
	}, [options.length, query, setOverlay])

	if (all.length === 0) return null
	return (
		<LexicalTypeaheadMenuPlugin<CommandOption>
			anchorClassName="conversations-menu-anchor"
			menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
				query === null || options.length === 0 ? null : (
					<ComposerMenu
						anchor={anchor.current}
						entries={options.map((option) => ({
							// Ranked results mix groups, so headings show only for the full list.
							group: query ? undefined : option.group,
							groupKey: option.groupKey,
							key: option.key,
							node: (
								<>
									<span className="conversations-menu__icon">
										{option.item.Icon ? <option.item.Icon /> : null}
									</span>
									<span className="conversations-menu__label">{option.label}</span>
								</>
							),
						}))}
						onHover={setHighlightedIndex}
						onPick={(index) => {
							const option = options[index]
							if (option) selectOptionAndCleanUp(option)
						}}
						selectedIndex={selectedIndex}
						setRef={(index, element) => options[index]?.setRefElement(element)}
					/>
				)
			}
			onQueryChange={setQuery}
			onSelectOption={(option, textNode: null | TextNode, closeMenu) => {
				const queryString = query ?? ''
				editor.update(() => {
					textNode?.remove()
					closeMenu()
				})
				option.item.onSelect({ editor, queryString })
			}}
			options={options}
			triggerFn={trigger}
		/>
	)
}
