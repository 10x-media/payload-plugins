import type { Config } from 'payload'
import { buildFormsCollection } from '../collections/forms'

export const registerCollections = (config: Config): void => {
	config.collections = [...(config.collections ?? []), buildFormsCollection()]
}
