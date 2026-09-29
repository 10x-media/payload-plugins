'use client'

import {
	$createTextNode,
	$getSelection,
	$isRangeSelection,
	FORMAT_TEXT_COMMAND,
	type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import {
	$createLinkNode,
	$isLinkNode,
	AutoLinkNode,
	LinkNode,
} from '@payloadcms/richtext-lexical/lexical/link'
import {
	$isListNode,
	INSERT_ORDERED_LIST_COMMAND,
	INSERT_UNORDERED_LIST_COMMAND,
	ListItemNode,
	ListNode,
} from '@payloadcms/richtext-lexical/lexical/list'
import {
	BOLD_ITALIC_STAR,
	BOLD_STAR,
	BOLD_UNDERSCORE,
	ITALIC_STAR,
	ITALIC_UNDERSCORE,
	ORDERED_LIST,
	type TextMatchTransformer,
	UNORDERED_LIST,
} from '@payloadcms/richtext-lexical/lexical/markdown'
import { AutoLinkPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalAutoLinkPlugin'
import { LinkPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalListPlugin'
import { $findMatchingParent } from '@payloadcms/richtext-lexical/lexical/utils'

import { MentionNode } from '../editor/mention/MentionNode'
import { AtIcon, BoldIcon, BulletListIcon, ItalicIcon, LinkIcon, NumberedListIcon } from './icons'
import { isAllowedUrl, normalizeUrl } from './links'
import { LINK_ATTRIBUTES, LinkEditor } from './plugins/LinkEditor'
import { MentionTypeahead } from './plugins/MentionTypeahead'
import { OPEN_LINK_EDITOR_COMMAND } from './runtime'
import type { ComposerFeature, ComposerItemState, ComposerLabels } from './types'

const hasFormat =
	(format: 'bold' | 'italic') =>
	({ selection }: ComposerItemState) =>
		$isRangeSelection(selection) && selection.hasFormat(format)

/** Bold: `format` toolbar group, `**text**`. */
export const boldFeature = (): ComposerFeature => ({
	key: 'bold',
	markdown: [BOLD_ITALIC_STAR, BOLD_STAR, BOLD_UNDERSCORE],
	toolbar: {
		groups: [
			{
				items: [
					{
						ChildComponent: BoldIcon,
						isActive: hasFormat('bold'),
						key: 'bold',
						label: ({ labels }) => labels.bold,
						onSelect: ({ editor }) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'),
						order: 10,
					},
				],
				key: 'format',
				order: 10,
				type: 'buttons',
			},
		],
	},
})

/** Italic: `format` toolbar group, `*text*`. */
export const italicFeature = (): ComposerFeature => ({
	key: 'italic',
	markdown: [ITALIC_STAR, ITALIC_UNDERSCORE],
	toolbar: {
		groups: [
			{
				items: [
					{
						ChildComponent: ItalicIcon,
						isActive: hasFormat('italic'),
						key: 'italic',
						label: ({ labels }) => labels.italic,
						onSelect: ({ editor }) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'),
						order: 20,
					},
				],
				key: 'format',
				order: 10,
				type: 'buttons',
			},
		],
	},
})

const URL_PATTERN =
	/((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)(?<![-.+():%])/
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-zA-Z]{2,}/

const matcher = (pattern: RegExp, toUrl: (text: string) => string) => (text: string) => {
	const match = pattern.exec(text)
	return match
		? {
				attributes: LINK_ATTRIBUTES,
				index: match.index,
				length: match[0].length,
				text: match[0],
				url: toUrl(match[0]),
			}
		: null
}

const AUTO_LINK_MATCHERS = [
	matcher(URL_PATTERN, (text) => (/^https?:\/\//.test(text) ? text : `https://${text}`)),
	matcher(EMAIL_PATTERN, (text) => `mailto:${text}`),
]

/** `[text](url)` becomes a link as the closing parenthesis is typed; other schemes stay text. */
const MARKDOWN_LINK: TextMatchTransformer = {
	dependencies: [LinkNode],
	importRegExp: /\[([^[\]]+)\]\(([^()\s]+)\)/,
	regExp: /\[([^[\]]+)\]\(([^()\s]+)\)$/,
	replace: (node, match) => {
		const [, text, raw] = match
		const url = raw ? normalizeUrl(raw) : null
		if (!text || !url) return
		const link = $createLinkNode(url, LINK_ATTRIBUTES)
		const label = $createTextNode(text)
		label.setFormat(node.getFormat())
		link.append(label)
		node.replace(link)
	},
	trigger: ')',
	type: 'text-match',
}

const LinkPlugins = () => (
	<>
		<LinkPlugin attributes={LINK_ATTRIBUTES} validateUrl={isAllowedUrl} />
		<AutoLinkPlugin matchers={AUTO_LINK_MATCHERS} />
		<LinkEditor />
	</>
)

const openLinkEditor = (editor: LexicalEditor) =>
	editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined)

/** External links (http, https, mailto) in an inline field; typed URLs link themselves. */
export const linkFeature = (): ComposerFeature => ({
	key: 'link',
	markdown: [MARKDOWN_LINK],
	nodes: [LinkNode, AutoLinkNode],
	Plugin: LinkPlugins,
	slashMenu: {
		groups: [
			{
				items: [
					{
						Icon: LinkIcon,
						key: 'link',
						keywords: ['url', 'href'],
						label: ({ labels }) => labels.link,
						onSelect: ({ editor }) => openLinkEditor(editor),
					},
				],
				key: 'insert',
				label: ({ labels }) => labels.groupInsert,
			},
		],
	},
	toolbar: {
		groups: [
			{
				items: [
					{
						ChildComponent: LinkIcon,
						isActive: ({ selection }) =>
							$isRangeSelection(selection) &&
							$findMatchingParent(selection.anchor.getNode(), $isLinkNode) !== null,
						key: 'link',
						label: ({ labels }) => labels.link,
						onSelect: ({ editor }) => openLinkEditor(editor),
						order: 10,
					},
				],
				key: 'insert',
				order: 20,
				type: 'buttons',
			},
		],
	},
})

const inList =
	(type: 'bullet' | 'number') =>
	({ selection }: ComposerItemState) => {
		if (!$isRangeSelection(selection)) return false
		const list = $findMatchingParent(selection.anchor.getNode(), $isListNode)
		return $isListNode(list) && list.getListType() === type
	}

/**
 * Bulleted and numbered lists: `/` and markdown (`- `, `1. `). In the
 * toolbar, as a `lists` group, with `toolbar: true`.
 */
export const listsFeature = ({ toolbar = false }: { toolbar?: boolean } = {}): ComposerFeature => {
	const lists = [
		{
			command: INSERT_UNORDERED_LIST_COMMAND,
			Icon: BulletListIcon,
			key: 'bulletList',
			keywords: ['ul', 'unordered', 'bullet'],
			label: ({ labels }: { labels: ComposerLabels }) => labels.bulletList,
			type: 'bullet' as const,
		},
		{
			command: INSERT_ORDERED_LIST_COMMAND,
			Icon: NumberedListIcon,
			key: 'numberedList',
			keywords: ['ol', 'ordered', 'number'],
			label: ({ labels }: { labels: ComposerLabels }) => labels.numberedList,
			type: 'number' as const,
		},
	]
	return {
		key: 'lists',
		markdown: [UNORDERED_LIST, ORDERED_LIST],
		nodes: [ListNode, ListItemNode],
		Plugin: ListPlugin,
		slashMenu: {
			groups: [
				{
					items: lists.map((list) => ({
						Icon: list.Icon,
						key: list.key,
						keywords: list.keywords,
						label: list.label,
						onSelect: ({ editor }: { editor: LexicalEditor }) =>
							editor.dispatchCommand(list.command, undefined),
					})),
					key: 'lists',
					label: ({ labels }) => labels.groupLists,
				},
			],
		},
		toolbar: toolbar
			? {
					groups: [
						{
							items: lists.map((list, index) => ({
								ChildComponent: list.Icon,
								isActive: inList(list.type),
								key: list.key,
								label: list.label,
								onSelect: ({ editor }: { editor: LexicalEditor }) =>
									editor.dispatchCommand(list.command, undefined),
								order: (index + 1) * 10,
							})),
							key: 'lists',
							order: 30,
							type: 'buttons',
						},
					],
				}
			: undefined,
	}
}

const insertMentionTrigger = (editor: LexicalEditor) => {
	editor.update(() => {
		const selection = $getSelection()
		if (!$isRangeSelection(selection)) return
		const node = selection.anchor.getNode()
		const offset = selection.anchor.offset
		const before = node.getTextContent()[offset - 1]
		const needsSpace = offset > 0 && before !== undefined && !/\s/.test(before)
		selection.insertText(needsSpace ? ' @' : '@')
	})
	editor.focus()
}

/** `@` mentions of users who can read the channel. */
export const mentionFeature = (): ComposerFeature => ({
	key: 'mention',
	nodes: [MentionNode],
	Plugin: MentionTypeahead,
	slashMenu: {
		groups: [
			{
				items: [
					{
						Icon: AtIcon,
						key: 'mention',
						keywords: ['user', 'person', 'at'],
						label: ({ labels }) => labels.mention,
						onSelect: ({ editor }) => insertMentionTrigger(editor),
					},
				],
				key: 'insert',
				label: ({ labels }) => labels.groupInsert,
			},
		],
	},
	toolbar: {
		groups: [
			{
				items: [
					{
						ChildComponent: AtIcon,
						key: 'mention',
						label: ({ labels }) => labels.mention,
						onSelect: ({ editor }) => insertMentionTrigger(editor),
						order: 20,
					},
				],
				key: 'insert',
				order: 20,
				type: 'buttons',
			},
		],
	},
})

/** The composer's default features, matching the instance's default server editor. */
export const defaultComposerFeatures = (): ComposerFeature[] => [
	boldFeature(),
	italicFeature(),
	linkFeature(),
	listsFeature(),
	mentionFeature(),
]
