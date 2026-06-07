import type { CollectionConfig } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export const FORMS_SLUG = 'forms'

export const buildFormsCollection = (): CollectionConfig => ({
	slug: FORMS_SLUG,
	labels: { singular: 'Form', plural: 'Forms' },
	admin: { group: 'Forms', useAsTitle: 'title' },
	access: { read: () => true },
	fields: [{ name: 'title', type: 'text', required: true, label: labelForKey(keys.fieldTitle) }],
})
