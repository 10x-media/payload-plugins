/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'formBuilder:pluginName',
	fieldTitle: 'formBuilder:fieldTitle',
	fieldTypeText: 'formBuilder:fieldType.text',
	fieldTypeTextarea: 'formBuilder:fieldType.textarea',
	fieldTypeEmail: 'formBuilder:fieldType.email',
	fieldTypeNumber: 'formBuilder:fieldType.number',
	fieldTypeSelect: 'formBuilder:fieldType.select',
	fieldTypeCheckbox: 'formBuilder:fieldType.checkbox',
	configOptions: 'formBuilder:config.options',
	configOption: 'formBuilder:config.option',
	configOptionLabel: 'formBuilder:config.optionLabel',
	configOptionValue: 'formBuilder:config.optionValue',
	validationEmail: 'formBuilder:validation.email',
	validationNumber: 'formBuilder:validation.number',
	validationSelect: 'formBuilder:validation.select',
	formatYes: 'formBuilder:format.yes',
	formatNo: 'formBuilder:format.no',
	configName: 'formBuilder:config.name',
	configLabel: 'formBuilder:config.label',
	configRequired: 'formBuilder:config.required',
	configWidth: 'formBuilder:config.width',
	configPlaceholder: 'formBuilder:config.placeholder',
	configDescription: 'formBuilder:config.description',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
