/**
 * Separator for packing ids into one string. `useFormFields` compares what its selector
 * returns, so the ids travel as a string rather than a fresh array, which would count as a
 * change on every render. A comma would not do: Payload allows custom ids, including text
 * ones, and a comma inside an id is legal. A NUL byte is not.
 */
export const ID_SEPARATOR = '\u0000'

type PolymorphicPair = { relationTo: unknown; value: unknown }

/**
 * The ids an upload field's value refers to, narrowed to one collection.
 *
 * Mirrors how Payload's upload field reads its own value when it builds the `filterOptions`
 * that hide already-picked files from the list tab: a single value counts the same as an
 * array of one, and polymorphic entries are grouped by the collection they point at.
 *
 * The shapes are checked in the only order that cannot confuse them:
 *
 * 1. `{ relationTo, value }` is a polymorphic pair, and never carries an `id`
 * 2. `{ id }` is a populated document, which always carries one
 * 3. `{ value }` alone is the non-polymorphic object form
 *
 * Checking `value` first would read a populated document that happens to have a field named
 * `value` as a polymorphic pair, and store that field's contents instead of the id.
 */
export const chosenUploadIds = (value: unknown, collectionSlug: string): string[] => {
	const entries = Array.isArray(value) ? value : [value]
	const ids: string[] = []

	for (const entry of entries) {
		if (entry === null || entry === undefined) {
			continue
		}

		if (typeof entry !== 'object') {
			ids.push(String(entry))
			continue
		}

		if ('relationTo' in entry && 'value' in entry) {
			const pair = entry as PolymorphicPair
			if (pair.relationTo === collectionSlug) {
				ids.push(String(pair.value))
			}
			continue
		}

		if ('id' in entry) {
			ids.push(String((entry as { id: unknown }).id))
			continue
		}

		if ('value' in entry) {
			ids.push(String((entry as { value: unknown }).value))
		}
	}

	return ids.filter(Boolean)
}
