'use client'

import { createElement } from 'react'
import { defaultPresentationDescriptors } from '../../presentations/defaults'
import { DialogSurface } from './DialogSurface'
import type { FormPresentation, PresentationWrapperProps } from './types'

const overlayWrapper = (surface: 'modal' | 'drawer') => {
	const Wrapper = ({ open, onClose, title, closeLabel, children }: PresentationWrapperProps) =>
		createElement(DialogSurface, { open, onClose, label: title, surface, closeLabel }, children)
	Wrapper.displayName = `${surface}Wrapper`
	return Wrapper
}

export const defaultPresentations: Record<string, FormPresentation> = {
	page: defaultPresentationDescriptors.page,
	inline: defaultPresentationDescriptors.inline,
	modal: { ...defaultPresentationDescriptors.modal, Wrapper: overlayWrapper('modal') },
	drawer: { ...defaultPresentationDescriptors.drawer, Wrapper: overlayWrapper('drawer') },
}
