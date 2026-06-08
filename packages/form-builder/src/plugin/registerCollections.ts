import type { Config } from 'payload'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { FieldTypeRegistry } from '../fields/registry'

export const registerCollections = (config: Config, registry: FieldTypeRegistry): void => {
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection(registry),
		buildSubmissionsCollection(registry),
	]
}
