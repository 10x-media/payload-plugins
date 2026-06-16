import type { ComponentType, ReactNode } from 'react'
import type { PresentationDescriptor } from '../../presentations/types'

export type PresentationWrapperProps = {
	presentation: FormPresentation
	open: boolean
	onClose: () => void
	/** Accessible name for an overlay surface (e.g. the form title). */
	title?: string
	children: ReactNode
}

/** A descriptor plus an optional React wrapper. page/inline omit the wrapper; modal/drawer provide one. */
export type FormPresentation = PresentationDescriptor & {
	Wrapper?: ComponentType<PresentationWrapperProps>
}
