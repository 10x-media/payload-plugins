import type { Config } from 'payload'
import type { ActionRegistry } from '../actions/registry'
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
	actionRegistry: ActionRegistry
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	presentationRegistry,
	actionRegistry,
}: RegisterCollectionsArgs): void => {
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection({ registry, ruleRegistry, presentationRegistry, actionRegistry }),
		buildSubmissionsCollection(registry, ruleRegistry),
	]
}
