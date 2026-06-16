import { keys } from '../translations/keys'
import type { PresentationDescriptor } from './types'

export const DEFAULT_PRESENTATION_NAME = 'page'

export const defaultPresentationDescriptors = {
	page: { name: 'page', label: keys.presentationPage, surface: 'page', density: 'comfortable' },
	inline: {
		name: 'inline',
		label: keys.presentationInline,
		surface: 'inline',
		density: 'comfortable',
	},
	modal: {
		name: 'modal',
		label: keys.presentationModal,
		surface: 'overlay',
		density: 'comfortable',
		dismissOnSuccess: true,
	},
	drawer: {
		name: 'drawer',
		label: keys.presentationDrawer,
		surface: 'overlay',
		density: 'comfortable',
		dismissOnSuccess: true,
	},
} satisfies Record<string, PresentationDescriptor>
