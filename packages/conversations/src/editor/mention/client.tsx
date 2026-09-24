'use client'

import {
	createClientFeature,
	toolbarFeatureButtonsGroupWithItems,
} from '@payloadcms/richtext-lexical/client'
import {
	$applyNodeReplacement,
	$getSelection,
	$isRangeSelection,
	type LexicalNode,
} from '@payloadcms/richtext-lexical/lexical'

import { MentionPlugin } from './MentionPlugin'
import { type MentionData, MentionServerNode } from './node'
import type { MentionClientProps } from './server'
import './mention.css'

const MentionChip = ({ label, userKey }: MentionData) => (
	<span className="conversations-mention" data-user={userKey}>
		@{label}
	</span>
)

/** The mention node in the browser: the server node plus its chip. */
export class MentionNode extends MentionServerNode {
	static override getType(): string {
		return MentionServerNode.getType()
	}

	static override clone(node: MentionNode): MentionNode {
		return new MentionNode({ key: node.__key, label: node.__label, userKey: node.__userKey })
	}

	static override importJSON(serializedNode: Parameters<typeof MentionServerNode.importJSON>[0]) {
		return $createMentionNode({ label: serializedNode.label, userKey: serializedNode.userKey })
	}

	override decorate() {
		return <MentionChip label={this.__label} userKey={this.__userKey} />
	}
}

export const $createMentionNode = (data: MentionData): MentionNode =>
	$applyNodeReplacement(new MentionNode(data))

export const $isMentionNode = (node: LexicalNode | null | undefined): node is MentionNode =>
	node instanceof MentionNode

const AtIcon = () => (
	<svg aria-hidden="true" className="icon" fill="none" height="20" viewBox="0 0 20 20" width="20">
		<circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
		<path
			d="M13 10v1.25a2 2 0 0 0 4 0V10a7 7 0 1 0-2.75 5.57"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.5"
		/>
	</svg>
)

export const ConversationsMentionFeatureClient = createClientFeature<MentionClientProps>(
	({ props }) => ({
		nodes: [MentionNode],
		plugins: [{ Component: MentionPlugin, position: 'normal' }],
		sanitizedClientFeatureProps: props,
		toolbarFixed: {
			groups: [
				toolbarFeatureButtonsGroupWithItems([
					{
						ChildComponent: AtIcon,
						key: 'conversationsMention',
						label: ({ i18n }) => (i18n.t as (key: string) => string)('conversations:mention'),
						onSelect: ({ editor }) => {
							editor.update(() => {
								const selection = $getSelection()
								if ($isRangeSelection(selection)) {
									const before = selection.anchor.getNode().getTextContent()
									const offset = selection.anchor.offset
									const needsSpace = offset > 0 && !/\s/.test(before[offset - 1] ?? ' ')
									selection.insertText(needsSpace ? ' @' : '@')
								}
							})
							editor.focus()
						},
						order: 10,
					},
				]),
			],
		},
	})
)
