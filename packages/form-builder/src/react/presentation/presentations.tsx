'use client'

import { createElement } from 'react'
import { defaultPresentationDescriptors } from '../../presentations/defaults'
import type { PresentationDescriptor } from '../../presentations/types'
import { DialogSurface } from './DialogSurface'
import type { FormPresentation, PresentationWrapperProps } from './types'

const overlayWrapper = (surface: 'modal' | 'drawer') => {
	const Wrapper = ({ open, onClose, title, children }: PresentationWrapperProps) =>
		createElement(DialogSurface, { open, onClose, label: title, surface }, children)
	Wrapper.displayName = `${surface}Wrapper`
	return Wrapper
}

export const defaultPresentations: Record<string, FormPresentation> = {
	page: defaultPresentationDescriptors.page as PresentationDescriptor,
	inline: defaultPresentationDescriptors.inline as PresentationDescriptor,
	modal: {
		...(defaultPresentationDescriptors.modal as PresentationDescriptor),
		Wrapper: overlayWrapper('modal'),
	},
	drawer: {
		...(defaultPresentationDescriptors.drawer as PresentationDescriptor),
		Wrapper: overlayWrapper('drawer'),
	},
}
