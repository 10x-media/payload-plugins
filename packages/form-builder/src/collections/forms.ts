import type { CollectionConfig } from 'payload'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import type { FieldTypeRegistry } from '../fields/registry'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'

export const FORMS_SLUG = 'forms'

export const buildFormsCollection = (
	registry: FieldTypeRegistry,
	_ruleRegistry: ValidationRuleRegistry
): CollectionConfig => ({
	slug: FORMS_SLUG,
	labels: { singular: 'Form', plural: 'Forms' },
	admin: { group: 'Forms', useAsTitle: 'title' },
	access: { read: () => true },
	fields: [
		{ name: 'title', type: 'text', required: true, label: labelForKey(keys.fieldTitle) },
		{ name: 'fields', type: 'blocks', blocks: buildFieldBlocks(registry) },
	],
})
