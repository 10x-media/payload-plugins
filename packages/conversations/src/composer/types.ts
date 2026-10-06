import type {
	BaseSelection,
	Klass,
	LexicalEditor,
	LexicalNode,
} from '@payloadcms/richtext-lexical/lexical'
import type { Transformer } from '@payloadcms/richtext-lexical/lexical/markdown'
import type { ComponentType } from 'react'

/** The strings the built-in features show. The admin fills them from its translations. */
export type ComposerLabels = {
	bold: string
	bulletList: string
	groupInsert: string
	groupLists: string
	italic: string
	link: string
	linkApply: string
	linkEdit: string
	linkInvalid: string
	linkPlaceholder: string
	linkRemove: string
	mention: string
	mentionNoResults: string
	/** The toolbar's overflow menu. */
	more: string
	numberedList: string
}

/** Looks up any translation key; in the admin it is Payload's `t`. Identity by default. */
export type ComposerTranslate = (key: string, vars?: Record<string, unknown>) => string

/** A label: a string, or built from the composer's labels and `t`. */
export type ComposerLabel =
	| ((args: { labels: ComposerLabels; t: ComposerTranslate }) => string)
	| string

/** What `isActive` and `isEnabled` get; they run inside `editorState.read()`. */
export type ComposerItemState = { editor: LexicalEditor; selection: BaseSelection | null }

/** Props of a toolbar item's own `Component`, which replaces the default button. */
export type ComposerToolbarItemProps = {
	active: boolean
	/** Closes the dropdown the item sits in; a no-op in a buttons group. */
	close: () => void
	editor: LexicalEditor
	enabled: boolean
	item: ComposerToolbarItem
}

/** One entry of a toolbar group. Shaped after Payload's `ToolbarGroupItem`. */
export type ComposerToolbarItem = {
	/** The icon of the default button, and of the dropdown row. */
	ChildComponent?: ComponentType
	/** Full control: rendered instead of the default button. */
	Component?: ComponentType<ComposerToolbarItemProps>
	isActive?: (state: ComposerItemState) => boolean
	isEnabled?: (state: ComposerItemState) => boolean
	key: string
	label?: ComposerLabel
	onSelect?: (args: { editor: LexicalEditor; isActive: boolean }) => void
	order?: number
}

/**
 * A toolbar group. Groups with the same `key` from several features merge, so
 * a feature can add to `format` or `insert`. Shaped after Payload's
 * `ToolbarGroup`: `buttons` shows its items side by side, `dropdown` behind
 * one button.
 */
export type ComposerToolbarGroup =
	| { items: ComposerToolbarItem[]; key: string; order?: number; type: 'buttons' }
	| {
			/** The dropdown button's icon; default: the active item's, else the first item's. */
			ChildComponent?: ComponentType
			items: ComposerToolbarItem[]
			key: string
			label?: ComposerLabel
			order?: number
			type: 'dropdown'
	  }

/** One `/` command. Shaped after Payload's `SlashMenuItem`. */
export type ComposerSlashItem = {
	Icon?: ComponentType
	key: string
	/** Extra words the query matches. */
	keywords?: string[]
	label?: ComposerLabel
	onSelect: (args: { editor: LexicalEditor; queryString: string }) => void
}

/** A titled section of the `/` menu; same-key groups merge across features. */
export type ComposerSlashGroup = { items: ComposerSlashItem[]; key: string; label?: ComposerLabel }

/**
 * A composer feature: nodes it registers, toolbar groups, `/` menu groups,
 * markdown shortcuts, and a plugin rendered inside the editor. Its nodes must
 * also be known to the instance's server editor (`editor` option), or the
 * server rejects the message.
 */
export type ComposerFeature = {
	key: string
	markdown?: Transformer[]
	nodes?: Array<Klass<LexicalNode>>
	Plugin?: ComponentType
	slashMenu?: { groups: ComposerSlashGroup[] }
	toolbar?: { groups: ComposerToolbarGroup[] }
}

/** Types a feature in place; returns it unchanged. */
export const defineComposerFeature = <T extends ComposerFeature>(feature: T): T => feature

export const labelOf = (
	label: ComposerLabel | undefined,
	fallback: string,
	args: { labels: ComposerLabels; t: ComposerTranslate }
): string => (label === undefined ? fallback : typeof label === 'function' ? label(args) : label)
