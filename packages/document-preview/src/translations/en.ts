import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.actualSize]: 'Actual size',
	[keys.clickToInteract]: 'Click to interact',
	[keys.column]: 'Preview',
	[keys.columnCount]: '{{count}} columns',
	[keys.failed]: 'This file could not be previewed.',
	[keys.fitPage]: 'Whole page',
	[keys.fitSlide]: 'Whole slide',
	[keys.fitToView]: 'Fit to view',
	[keys.fitWidth]: 'Fit width',
	[keys.loading]: 'Loading preview…',
	[keys.nextSlide]: 'Next slide',
	[keys.openInNewTab]: 'Open in new tab',
	[keys.pageOf]: 'Page {{current}} of {{total}}',
	[keys.pages]: 'Pages',
	[keys.pdfUnsupported]: 'This browser cannot show PDFs inline.',
	[keys.pluginName]: 'Document Preview',
	[keys.preview]: 'Preview',
	[keys.previousSlide]: 'Previous slide',
	[keys.previewFile]: 'Preview {{filename}}',
	[keys.rowCount]: '{{count}} rows',
	[keys.slideOf]: 'Slide {{current}} of {{total}}',
	[keys.slides]: 'Slides',
	[keys.tooLarge]: 'This file is too large to preview ({{size}}).',
	[keys.unsupported]: 'There is no preview for this file type.',
	[keys.zoomIn]: 'Zoom in',
	[keys.zoomOut]: 'Zoom out',
}
