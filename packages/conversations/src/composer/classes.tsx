'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

/**
 * Every part of the composer a skin can style, with its default class. The
 * defaults are the admin's look (`composer.css`, Payload's variables).
 */
export const COMPOSER_CLASSES = {
	/** The box around toolbar, editor and footer. `data-toolbar` says where the toolbar sits. */
	root: 'conversations-editor',
	/** The formatting row. */
	toolbar: 'conversations-editor__toolbar',
	/** A group of tools in the row. */
	toolbarGroup: 'conversations-editor__unit',
	/** The line between groups. */
	toolbarDivider: 'conversations-editor__divider',
	/** A toolbar button; `toolActive` is added while it applies or its dropdown is open. */
	tool: 'conversations-editor__tool',
	toolActive: 'conversations-editor__tool--active',
	/** A toolbar button that opens a dropdown (a group, or "More"). */
	toolDropdown: 'conversations-editor__tool--dropdown',
	/** Wraps the editable area and its placeholder. */
	input: 'conversations-editor__input',
	/** The editable area itself. */
	content: 'conversations-editor__content',
	placeholder: 'conversations-editor__placeholder',
	/** The bottom row under the editor. */
	footer: 'conversations-editor__footer',
	/** The right side of the footer, where the host's buttons go. */
	footerEnd: 'conversations-editor__end',
	/** A floating list: the `/` and `@` menus, toolbar dropdowns, "More". */
	menu: 'conversations-menu',
	/** Added to `menu` when it drops from a toolbar button. */
	menuDropdown: 'conversations-menu--dropdown',
	menuItem: 'conversations-menu__item',
	/** Added to `menuItem` while it is highlighted or applies. */
	menuItemSelected: 'conversations-menu__item--selected',
	menuIcon: 'conversations-menu__icon',
	menuLabel: 'conversations-menu__label',
	/** A person's picture or initials in the `@` menu. */
	menuAvatar: 'conversations-avatar',
	/** A group heading in a menu. */
	menuGroup: 'conversations-menu__group',
	menuEmpty: 'conversations-menu__empty',
	/** The floating link field (editing) and link tooltip (preview). */
	linkEditor: 'conversations-link-editor',
	/** Added to `linkEditor` for the tooltip over an existing link. */
	linkPreview: 'conversations-link-editor--preview',
	linkRow: 'conversations-link-editor__row',
	linkInput: 'conversations-link-editor__input',
	linkUrl: 'conversations-link-editor__url',
	linkButton: 'conversations-link-editor__button',
	linkError: 'conversations-link-editor__error',
	/** Text inside the editor. */
	bold: 'conversations-editor__bold',
	italic: 'conversations-editor__italic',
	link: 'conversations-editor__link',
	paragraph: 'conversations-editor__paragraph',
	ul: 'conversations-editor__ul',
	ol: 'conversations-editor__ol',
	listItem: 'conversations-editor__listitem',
	nestedListItem: 'conversations-editor__listitem--nested',
} as const

export type ComposerPart = keyof typeof COMPOSER_CLASSES

/** Classes added to composer parts; with `unstyled` they replace the defaults. */
export type ComposerClassNames = Partial<Record<ComposerPart, string>>

type ClassContext = { classNames?: ComposerClassNames; unstyled?: boolean }

const Context = createContext<ClassContext>({})

export const ComposerClassProvider = ({
	children,
	classNames,
	unstyled,
}: ClassContext & { children?: ReactNode }) => {
	const value = useMemo(() => ({ classNames, unstyled }), [classNames, unstyled])
	return <Context.Provider value={value}>{children}</Context.Provider>
}

/** The class of a part: its default (unless `unstyled`) plus the host's. */
export const composerClass = ({ classNames, unstyled }: ClassContext, part: ComposerPart): string =>
	[unstyled ? null : COMPOSER_CLASSES[part], classNames?.[part]].filter(Boolean).join(' ')

/** `cx('menuItem', selected && 'menuItemSelected')`: the classes of one element's parts. */
export const useComposerClasses = () => {
	const context = useContext(Context)
	return (...parts: Array<ComposerPart | false | null | undefined>) =>
		parts
			.filter((part): part is ComposerPart => Boolean(part))
			.map((part) => composerClass(context, part))
			.filter(Boolean)
			.join(' ')
}
