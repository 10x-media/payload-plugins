/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	actualSize: 'documentPreview:actualSize',
	clickToInteract: 'documentPreview:clickToInteract',
	column: 'documentPreview:column',
	columnCount: 'documentPreview:columnCount',
	failed: 'documentPreview:failed',
	fitPage: 'documentPreview:fitPage',
	fitSlide: 'documentPreview:fitSlide',
	fitToView: 'documentPreview:fitToView',
	fitWidth: 'documentPreview:fitWidth',
	loading: 'documentPreview:loading',
	nextSlide: 'documentPreview:nextSlide',
	openInNewTab: 'documentPreview:openInNewTab',
	pageOf: 'documentPreview:pageOf',
	pages: 'documentPreview:pages',
	pdfUnsupported: 'documentPreview:pdfUnsupported',
	pluginName: 'documentPreview:pluginName',
	preview: 'documentPreview:preview',
	previousSlide: 'documentPreview:previousSlide',
	previewFile: 'documentPreview:previewFile',
	rowCount: 'documentPreview:rowCount',
	slideOf: 'documentPreview:slideOf',
	slides: 'documentPreview:slides',
	tooLarge: 'documentPreview:tooLarge',
	unsupported: 'documentPreview:unsupported',
	zoomIn: 'documentPreview:zoomIn',
	zoomOut: 'documentPreview:zoomOut',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
