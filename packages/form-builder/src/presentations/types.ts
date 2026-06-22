/** How a presentation surfaces the form. Drives wrapper selection and CSS. */
export type PresentationSurface = 'inline' | 'page' | 'overlay'

export type PresentationDensity = 'comfortable' | 'compact'

/**
 * Serializable, framework-agnostic description of a presentation. The admin select and the
 * stored `defaultPresentation` use only this; the React `Wrapper` is added in `./react`. No React here.
 */
export type PresentationDescriptor = {
	name: string
	/** i18n key or literal shown in the admin select. */
	label: string
	surface: PresentationSurface
	density: PresentationDensity
	/** Overlay surfaces request dismissal after a successful submit. */
	dismissOnSuccess?: boolean
}
