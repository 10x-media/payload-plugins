'use client'

import { createContext, type ReactNode, useContext } from 'react'

export type WikiFieldPickerContextValue = {
	/** Whether the guide being edited already targets this schema path. */
	isSelected: (schemaPath: string) => boolean
	/** Attach or detach the schema path, in the drawer's working list. */
	toggle: (schemaPath: string) => void
}

const WikiFieldPickerContext = createContext<null | WikiFieldPickerContextValue>(null)

/**
 * How a rendered field learns it is being picked rather than edited.
 *
 * The picker renders the host's real fields, so every injected
 * `WikiFieldDescription` in the drawer is the same component that renders the
 * help surface on a document. Rather than threading a mode through form state,
 * the drawer wraps its subtree in this provider and the description branches on
 * whether it finds one: `null` everywhere else means the help surface is the
 * default and nothing about a normal edit view changes. React context crosses
 * the modal portal, and the provider exists only inside the drawer, so the
 * document the author came from never sees it.
 */
export const WikiFieldPickerProvider = ({
	children,
	value,
}: {
	children: ReactNode
	value: WikiFieldPickerContextValue
}) => <WikiFieldPickerContext.Provider value={value}>{children}</WikiFieldPickerContext.Provider>

/** The picker a field is being rendered inside, or `null` on a real document. */
export const useWikiFieldPicker = (): null | WikiFieldPickerContextValue =>
	useContext(WikiFieldPickerContext)
