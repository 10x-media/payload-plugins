'use client'

import { createContext, useContext } from 'react'

/** What the editor plugins inside a composer need from it. */
export type ComposerContextValue = {
	/** Focus the editor, caret at the end, as soon as it mounts. */
	autoFocus: boolean
	channel: string
	instance: string
	key: string
	/**
	 * The editor hands itself over, so a send reads the live state: Payload
	 * writes the field's form value on a debounce, and a quick Enter after the
	 * last keystroke would otherwise send what was there a moment before.
	 */
	registerEditor: (editor: { getEditorState: () => { toJSON: () => unknown } } | null) => void
	/** Report whether the mention menu is open, so Enter picks a user instead of sending. */
	setMenuOpen: (open: boolean) => void
	/** Whether the mention menu is open right now. */
	menuOpen: () => boolean
	submit: () => void
	submitOn: 'enter' | 'mod+enter'
}

export const ComposerContext = createContext<ComposerContextValue | null>(null)

/** The composer around the current editor, or null in any other rich text field. */
export const useComposerContext = (): ComposerContextValue | null => useContext(ComposerContext)
