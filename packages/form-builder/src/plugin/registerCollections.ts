import type { Config } from 'payload'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'

export const registerCollections = (config: Config): void => {
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection(),
		buildSubmissionsCollection(),
	]
}
