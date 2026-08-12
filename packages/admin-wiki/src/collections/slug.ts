import type { FieldHook } from 'payload'

import { slugify } from '../shared/slugify'

export { slugify }

/**
 * Fill the slug from the title when absent and normalize manual input.
 * Runs beforeValidate so uniqueness and publish validation see the final value.
 */
export const slugBeforeValidate: FieldHook = ({ data, value }) => {
	if (typeof value === 'string' && value.trim().length > 0) {
		return slugify(value)
	}
	const title = data?.title
	if (typeof title === 'string' && title.trim().length > 0) {
		return slugify(title)
	}
	return value
}
