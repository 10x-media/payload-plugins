import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Form Builder',
	[keys.fieldTitle]: 'Title',
	[keys.fieldTypeText]: 'Text',
	[keys.fieldTypeTextarea]: 'Long text',
	[keys.fieldTypeEmail]: 'Email',
	[keys.fieldTypeNumber]: 'Number',
	[keys.fieldTypeSelect]: 'Select',
	[keys.fieldTypeCheckbox]: 'Checkbox',
	[keys.configOptions]: 'Options',
	[keys.configOption]: 'Option',
	[keys.configOptionLabel]: 'Option label',
	[keys.configOptionValue]: 'Option value',
	[keys.validationRequired]: 'This field is required',
	[keys.validationEmail]: 'Enter a valid email address',
	[keys.validationNumber]: 'Enter a valid number',
	[keys.validationSelect]: 'Choose a valid option',
	[keys.formatYes]: 'Yes',
	[keys.formatNo]: 'No',
	[keys.configName]: 'Name',
	[keys.configLabel]: 'Label',
	[keys.configRequired]: 'Required',
	[keys.configWidth]: 'Width',
	[keys.configPlaceholder]: 'Placeholder',
	[keys.configDescription]: 'Description',
	[keys.submissionAnswers]: 'Answers',
	[keys.submissionNoAnswers]: 'No answers',
}
