'use client'

import type { PluginComponent, SlashMenuGroup, ToolbarGroup } from '@payloadcms/richtext-lexical'
import {
	createClientFeature,
	toolbarAddDropdownGroupWithItems,
} from '@payloadcms/richtext-lexical/client'
import {
	$applyNodeReplacement,
	$getSelection,
	$insertNodes,
	$isNodeSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_EDITOR,
	COMMAND_PRIORITY_LOW,
	createCommand,
	FORMAT_TEXT_COMMAND,
	type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import { useFormFields } from '@payloadcms/ui'
import { useEffect } from 'react'

import './token.css'

import { keys, type TranslationKey } from '../../translations/keys'
import { getWindowValues, setWindowValues } from './availability'
import { FloatingTokenEditorPlugin } from './FloatingTokenEditor'
import { tokenIcons } from './icons'
import { $isContentLockTokenNode, ContentLockTokenServerNode } from './node'
import type { ContentLockTokenClientProps } from './server'
import { TokenChip } from './TokenChip'
import {
	type SerializedTokenNode,
	TEXT_FORMAT_BITS,
	TOKEN_FEATURE_KEY,
	TOKEN_KINDS,
	TOKEN_NODE_TYPE,
	type TokenData,
	type TokenKind,
	type TokenTextFormat,
	tokenDataOf,
	tokenKindLabel,
	tokenProblem,
} from './types'

/** Client node: the server node plus the chip. */
export class ContentLockTokenNode extends ContentLockTokenServerNode {
	static override getType(): string {
		return TOKEN_NODE_TYPE
	}

	static override clone(node: ContentLockTokenNode): ContentLockTokenNode {
		return new ContentLockTokenNode(node.__data, node.__key)
	}

	static override importJSON(serializedNode: SerializedTokenNode): ContentLockTokenNode {
		return $createContentLockTokenNode(tokenDataOf(serializedNode))
	}

	override decorate() {
		return <TokenChip data={this.getData()} nodeKey={this.getKey()} />
	}
}

export function $createContentLockTokenNode(data: TokenData): ContentLockTokenNode {
	return $applyNodeReplacement(new ContentLockTokenNode(data))
}

const INSERT_TOKEN_COMMAND = createCommand<TokenKind>('CONTENT_LOCK_INSERT_TOKEN')

const TOKEN_TEXT_FORMATS = Object.keys(TEXT_FORMAT_BITS) as TokenTextFormat[]
const TOKEN_FORMAT_MASK = Object.values(TEXT_FORMAT_BITS).reduce((mask, bit) => mask | bit, 0)

const isTokenTextFormat = (type: string): type is TokenTextFormat =>
	(TOKEN_TEXT_FORMATS as string[]).includes(type)

/**
 * A new token of `kind`, in the text format the cursor is typing in. A fixed
 * date starts at the next full hour.
 */
const newToken = (kind: TokenKind, textFormat: number): TokenData => {
	if (kind !== 'date') {
		return { token: kind, format: 'datetime', textFormat }
	}
	const next = new Date()
	next.setHours(next.getHours() + 1, 0, 0, 0)
	return { token: 'date', format: 'datetime', date: next.toISOString(), textFormat }
}

/** Whether the window in `editor`'s form can fill a token of `kind`. */
const available = (editor: LexicalEditor, kind: TokenKind): boolean =>
	kind === 'date' || tokenProblem({ token: kind }, getWindowValues(editor)) === null

/**
 * Mirrors the form into the availability store the menus read, inserts tokens
 * at the cursor, and lets bold, italic, underline and strikethrough reach
 * tokens: a selected token toggles on its own, and a text selection spanning
 * tokens carries them along with the text.
 */
const TokenPlugin: PluginComponent<ContentLockTokenClientProps> = () => {
	const [editor] = useLexicalComposerContext()
	const announceAt = useFormFields(([fields]) => fields.announceAt?.value)
	const endAtTime = useFormFields(([fields]) => fields.endAtTime?.value)
	const lockEverything = useFormFields(([fields]) => fields.lockEverything?.value)

	useEffect(() => {
		setWindowValues(editor, { announceAt, endAtTime, lockEverything })
	}, [editor, announceAt, endAtTime, lockEverything])

	useEffect(
		() =>
			mergeRegister(
				editor.registerCommand(
					INSERT_TOKEN_COMMAND,
					(kind) => {
						const selection = $getSelection()
						if (!$isRangeSelection(selection)) {
							return false
						}
						$insertNodes([
							$createContentLockTokenNode(newToken(kind, selection.format & TOKEN_FORMAT_MASK)),
						])
						return true
					},
					COMMAND_PRIORITY_EDITOR
				),
				editor.registerCommand(
					FORMAT_TEXT_COMMAND,
					(type) => {
						if (!isTokenTextFormat(type)) {
							return false
						}
						const selection = $getSelection()
						if ($isNodeSelection(selection)) {
							const tokens = selection.getNodes().filter($isContentLockTokenNode)
							if (tokens.length === 0) {
								return false
							}
							const on = !tokens.every((token) => token.hasTextFormat(type))
							for (const token of tokens) token.setTextFormat(type, on)
							return true
						}
						if ($isRangeSelection(selection)) {
							// Match what the text around them is about to become; the core
							// handler still formats the text itself.
							const on = !selection.hasFormat(type)
							for (const node of selection.getNodes()) {
								if ($isContentLockTokenNode(node)) node.setTextFormat(type, on)
							}
						}
						return false
					},
					COMMAND_PRIORITY_LOW
				)
			),
		[editor]
	)

	return null
}

/**
 * Lexical hands menu items an `i18n` rather than letting them call a hook, so
 * the key is resolved by hand against this plugin's namespace.
 */
const label =
	(key: TranslationKey) =>
	({ i18n }: { i18n: { t: unknown } }) =>
		(i18n.t as (key: TranslationKey) => string)(key)

/**
 * Every kind, always: Payload only asks dynamic slash groups once a query is
 * typed, so a filtered list would hide the tokens from a bare `/`. A kind the
 * window cannot fill still inserts, and its chip says why it will show nothing.
 */
const slashGroups: SlashMenuGroup[] = [
	{
		key: TOKEN_FEATURE_KEY,
		label: label(keys.tokenGroupLabel),
		items: TOKEN_KINDS.map((kind) => ({
			Icon: tokenIcons[kind],
			key: `${TOKEN_FEATURE_KEY}-${kind}`,
			keywords: ['lock', 'token', kind],
			label: label(tokenKindLabel[kind]),
			onSelect: ({ editor }) => {
				editor.dispatchCommand(INSERT_TOKEN_COMMAND, kind)
			},
		})),
	},
]

const toolbarGroups: ToolbarGroup[] = [
	toolbarAddDropdownGroupWithItems(
		TOKEN_KINDS.map((kind) => ({
			ChildComponent: tokenIcons[kind],
			isEnabled: ({ editor }) => available(editor, kind),
			key: `${TOKEN_FEATURE_KEY}-${kind}`,
			label: label(tokenKindLabel[kind]),
			onSelect: ({ editor }) => {
				editor.dispatchCommand(INSERT_TOKEN_COMMAND, kind)
			},
		}))
	),
]

export const ContentLockTokenFeatureClient = createClientFeature<ContentLockTokenClientProps>(
	({ props }) => ({
		nodes: [ContentLockTokenNode],
		plugins: [
			{ Component: TokenPlugin, position: 'normal' },
			{ Component: FloatingTokenEditorPlugin, position: 'floatingAnchorElem' },
		],
		sanitizedClientFeatureProps: props,
		slashMenu: { groups: slashGroups },
		toolbarFixed: { groups: toolbarGroups },
	})
)
