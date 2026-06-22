import type { FormFieldConfigValues, FormFieldDefinition, FormFieldValueKind } from './types'

/**
 * Define a form field type once and get every facet from one object: a Payload `Field[]` for
 * authoring, an isomorphic `validate`, a localized `format`, and a renderer ref. Built-ins use
 * this same primitive, so custom field types are never second-class. The `value` kind drives the
 * typed value threaded into `validate`/`format`; the optional second generic types the config.
 */
export const defineFormField = <
	K extends FormFieldValueKind,
	TConfig extends FormFieldConfigValues = FormFieldConfigValues,
>(
	definition: FormFieldDefinition<K, TConfig>
): FormFieldDefinition<K, TConfig> => definition
