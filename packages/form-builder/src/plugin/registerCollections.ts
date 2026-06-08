import type { Config } from 'payload'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { FieldTypeRegistry } from '../fields/registry'
import type { ValidationRuleRegistry } from '../validation/registry'

export const registerCollections = (
	config: Config,
	registry: FieldTypeRegistry,
	ruleRegistry: ValidationRuleRegistry
): void => {
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection(registry, ruleRegistry),
		buildSubmissionsCollection(registry, ruleRegistry),
	]
}
