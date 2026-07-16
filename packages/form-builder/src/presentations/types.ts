/** How a presentation surfaces the form. Drives wrapper selection and CSS. */
export type PresentationSurface = 'inline' | 'page' | 'overlay'

export type PresentationDensity = 'comfortable' | 'compact'

/**
 * Serializable, framework-agnostic description of a presentation. `presentations/defaults.ts`
 * ships the built-ins the React presentation registry wraps with a `Wrapper` (see `./react`). No
 * React here.
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
