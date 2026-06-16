import type { Config } from 'payload'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { FieldTypeRegistry } from '../fields/registry'
import type { PresentationDescriptorRegistry } from '../presentations/registry'
import type { ValidationRuleRegistry } from '../validation/registry'

type RegisterCollectionsArgs = {
	config: Config
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	presentationRegistry: PresentationDescriptorRegistry
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	presentationRegistry,
}: RegisterCollectionsArgs): void => {
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection(registry, ruleRegistry, presentationRegistry),
		buildSubmissionsCollection(registry, ruleRegistry),
	]
}
