'use client'

import { type ComponentType, createContext, type ReactNode, useContext, useMemo } from 'react'

import {
	AtIcon,
	BoldIcon,
	BulletListIcon,
	CaretIcon,
	CheckIcon,
	CrossIcon,
	ItalicIcon,
	LinkIcon,
	MoreIcon,
	NumberedListIcon,
	PencilIcon,
} from './icons'

/**
 * Every icon the composer draws, by role. The defaults are the composer's own
 * line icons; the admin passes Payload's, a website skin its icon set.
 */
export type ComposerIcons = {
	bold: ComponentType
	/** After the icon of a toolbar dropdown. */
	caret: ComponentType
	italic: ComponentType
	/** The toolbar button and the `/` command. */
	link: ComponentType
	/** The link field's Apply button. */
	linkApply: ComponentType
	/** The link tooltip's Edit button. */
	linkEdit: ComponentType
	/** At the start of the link field and the link tooltip. */
	linkLeading: ComponentType
	/** Remove the link, in the tooltip and in the field of an existing link. */
	linkRemove: ComponentType
	bulletList: ComponentType
	mention: ComponentType
	/** The toolbar's overflow button. */
	more: ComponentType
	numberedList: ComponentType
}

export type ComposerIcon = keyof ComposerIcons

export const defaultComposerIcons: ComposerIcons = {
	bold: BoldIcon,
	bulletList: BulletListIcon,
	caret: CaretIcon,
	italic: ItalicIcon,
	link: LinkIcon,
	linkApply: CheckIcon,
	linkEdit: PencilIcon,
	linkLeading: LinkIcon,
	linkRemove: CrossIcon,
	mention: AtIcon,
	more: MoreIcon,
	numberedList: NumberedListIcon,
}

/** The defaults with `icons` laid over them; an icon set to `undefined` keeps its default. */
export const resolveComposerIcons = (icons?: Partial<ComposerIcons>): ComposerIcons => {
	const resolved = { ...defaultComposerIcons }
	for (const [key, Icon] of Object.entries(icons ?? {}) as Array<[ComposerIcon, ComponentType]>) {
		if (Icon) resolved[key] = Icon
	}
	return resolved
}

const ComposerIconsContext = createContext<ComposerIcons>(defaultComposerIcons)

export const ComposerIconProvider = ({
	children,
	icons,
}: {
	children: ReactNode
	icons?: Partial<ComposerIcons>
}) => {
	const value = useMemo(() => resolveComposerIcons(icons), [icons])
	return <ComposerIconsContext.Provider value={value}>{children}</ComposerIconsContext.Provider>
}

export const useComposerIcons = (): ComposerIcons => useContext(ComposerIconsContext)

const byRole = new Map<ComposerIcon, ComponentType>()

/**
 * A stable component that draws the composer's icon for `role`. Features are
 * built once, outside any composer, so they name a role rather than an icon;
 * the composer they render in decides which icon that is.
 */
export const composerIcon = (role: ComposerIcon): ComponentType => {
	let Icon = byRole.get(role)
	if (!Icon) {
		const Role = () => {
			const Drawn = useComposerIcons()[role]
			return <Drawn />
		}
		Role.displayName = `ComposerIcon(${role})`
		byRole.set(role, Role)
		Icon = Role
	}
	return Icon
}
