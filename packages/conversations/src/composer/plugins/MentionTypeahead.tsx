'use client'

import { $createTextNode, type TextNode } from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	useBasicTypeaheadTriggerMatch,
} from '@payloadcms/richtext-lexical/lexical/react/LexicalTypeaheadMenuPlugin'
import { useEffect, useMemo, useState } from 'react'

import { Avatar } from '../../client/Avatar'
import { $createMentionNode } from '../../editor/mention/MentionNode'
import { useMentionSearch } from '../../react/hooks'
import type { MentionCandidate } from '../../shared/wire'
import { useComposerClasses } from '../classes'
import { ComposerMenu } from '../Menu'
import { useComposerRuntime } from '../runtime'

class UserOption extends MenuOption {
	user: MentionCandidate

	constructor(user: MentionCandidate) {
		super(user.userKey)
		this.user = user
	}
}

const Typeahead = ({ channel, conversationKey }: { channel: string; conversationKey: string }) => {
	const [editor] = useLexicalComposerContext()
	const { labels, setOverlay } = useComposerRuntime()
	const cx = useComposerClasses()
	const [query, setQuery] = useState<null | string>(null)
	const trigger = useBasicTypeaheadTriggerMatch('@', { maxLength: 40, minLength: 0 })
	const { loading, users } = useMentionSearch({ channel, key: conversationKey, query })
	const options = useMemo(() => users.map((user) => new UserOption(user)), [users])

	// Enter picks a user while there are candidates; with none it sends.
	useEffect(() => {
		setOverlay('mention', query !== null && options.length > 0)
		return () => setOverlay('mention', false)
	}, [options.length, query, setOverlay])

	return (
		<LexicalTypeaheadMenuPlugin<UserOption>
			anchorClassName="conversations-menu-anchor"
			menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
				query === null ? null : (
					<ComposerMenu
						anchor={anchor.current}
						empty={loading ? '…' : labels.mentionNoResults}
						entries={options.map((option) => ({
							key: option.key,
							node: (
								<>
									<Avatar
										author={option.user}
										className={cx('menuAvatar')}
										size={20}
										userKey={option.user.userKey}
									/>
									<span className={cx('menuLabel')}>{option.user.name}</span>
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
				editor.update(() => {
					const mention = $createMentionNode({
						label: option.user.name,
						userKey: option.user.userKey,
					})
					if (textNode) textNode.replace(mention)
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

/** `@` opens a typeahead of users who can read the channel. Off without a mention target. */
export const MentionTypeahead = () => {
	const { mentions } = useComposerRuntime()
	if (!mentions) return null
	return <Typeahead channel={mentions.channel} conversationKey={mentions.conversationKey} />
}
