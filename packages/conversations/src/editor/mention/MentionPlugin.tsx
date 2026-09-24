'use client'

import {
	$createTextNode,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
	type TextNode,
} from '@payloadcms/richtext-lexical/lexical'
import { $isListItemNode } from '@payloadcms/richtext-lexical/lexical/list'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	useBasicTypeaheadTriggerMatch,
} from '@payloadcms/richtext-lexical/lexical/react/LexicalTypeaheadMenuPlugin'
import { $findMatchingParent } from '@payloadcms/richtext-lexical/lexical/utils'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { Avatar } from '../../client/Avatar'
import { type ComposerContextValue, useComposerContext } from '../../client/composerContext'
import { useMentionSearch } from '../../react/hooks'
import type { MentionCandidate } from '../../shared/wire'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { $createMentionNode } from './client'

/** One user in the typeahead. */
class UserOption extends MenuOption {
	user: MentionCandidate

	constructor(user: MentionCandidate) {
		super(user.userKey)
		this.user = user
	}
}

/**
 * Enter sends, Shift+Enter breaks the line; inside a list Enter makes the next
 * item, and while the mention menu is open Enter picks the highlighted user.
 * With `submitOn: 'mod+enter'` only Ctrl/Cmd+Enter sends.
 */
const SubmitOnEnter = ({ composer }: { composer: ComposerContextValue }) => {
	const [editor] = useLexicalComposerContext()
	useEffect(() => {
		composer.registerEditor(editor)
		return () => composer.registerEditor(null)
	}, [composer, editor])
	const { autoFocus } = composer
	useEffect(() => {
		if (autoFocus) editor.focus(undefined, { defaultSelection: 'rootEnd' })
	}, [autoFocus, editor])
	useEffect(
		() =>
			editor.registerCommand<KeyboardEvent | null>(
				KEY_ENTER_COMMAND,
				(event) => {
					if (!event || composer.menuOpen() || event.shiftKey) return false
					const modifier = event.ctrlKey || event.metaKey
					if (composer.submitOn === 'mod+enter' && !modifier) return false
					if (!modifier) {
						const selection = $getSelection()
						if (
							$isRangeSelection(selection) &&
							$findMatchingParent(selection.anchor.getNode(), $isListItemNode)
						) {
							return false
						}
					}
					event.preventDefault()
					composer.submit()
					return true
				},
				COMMAND_PRIORITY_HIGH
			),
		[composer, editor]
	)
	return null
}

const MentionTypeahead = ({ composer }: { composer: ComposerContextValue }) => {
	const [editor] = useLexicalComposerContext()
	const { t } = useTranslation()
	const [query, setQuery] = useState<null | string>(null)
	const trigger = useBasicTypeaheadTriggerMatch('@', { maxLength: 40, minLength: 0 })
	const { loading, users } = useMentionSearch({
		channel: composer.channel,
		key: composer.key,
		query,
	})
	const options = useMemo(() => users.map((user) => new UserOption(user)), [users])
	// Enter picks a user while the menu shows candidates; otherwise it sends.
	useEffect(() => {
		composer.setMenuOpen(query !== null && options.length > 0)
	}, [composer, options.length, query])

	return (
		<LexicalTypeaheadMenuPlugin<UserOption>
			menuRenderFn={(
				anchor,
				{ options: shown, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
			) =>
				anchor.current && query !== null
					? createPortal(
							<div className="conversations-mention-menu" role="listbox">
								{shown.length === 0 ? (
									<div className="conversations-mention-menu__empty">
										{loading ? '…' : t(keys.mentionNoResults)}
									</div>
								) : (
									shown.map((option, index) => (
										// biome-ignore lint/a11y/useKeyWithClickEvents: the editor owns the keyboard; arrows and Enter drive this list.
										<div
											aria-selected={selectedIndex === index}
											className={`conversations-mention-menu__item${selectedIndex === index ? ' conversations-mention-menu__item--selected' : ''}`}
											key={option.key}
											onClick={() => selectOptionAndCleanUp(option)}
											onMouseEnter={() => setHighlightedIndex(index)}
											ref={option.setRefElement}
											role="option"
											tabIndex={-1}
										>
											<Avatar author={option.user} size={20} userKey={option.user.userKey} />
											<span>{option.user.name}</span>
										</div>
									))
								)}
							</div>,
							anchor.current
						)
					: null
			}
			onQueryChange={setQuery}
			onSelectOption={(option, textNode: null | TextNode, closeMenu) => {
				editor.update(() => {
					const mention = $createMentionNode({
						label: option.user.name,
						userKey: option.user.userKey,
					})
					if (textNode) {
						textNode.replace(mention)
					} else {
						$getSelection()?.insertNodes([mention])
					}
					const space = $createTextNode(' ')
					mention.insertAfter(space)
					space.select()
					closeMenu()
				})
			}}
			options={options}
			triggerFn={trigger}
		/>
	)
}

/**
 * The editor half of a composer: mention typeahead and Enter-to-send. In any
 * rich text field outside a composer (no `ComposerContext`) it does nothing,
 * so the node still renders but offers no picker.
 */
export const MentionPlugin = () => {
	const composer = useComposerContext()
	if (!composer) return null
	return (
		<>
			<SubmitOnEnter composer={composer} />
			<MentionTypeahead composer={composer} />
		</>
	)
}
