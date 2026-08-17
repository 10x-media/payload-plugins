type PolymorphicPair = { relationTo: unknown; value: unknown }

/** An id as a string, or nothing when the candidate cannot stand for one. */
const readId = (candidate: unknown): string | undefined => {
	if (candidate === null || candidate === undefined) {
		return undefined
	}
	const id = String(candidate)
	return id === '' ? undefined : id
}

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

	const collect = (candidate: unknown) => {
		const id = readId(candidate)
		if (id !== undefined) {
			ids.push(id)
		}
	}

	for (const entry of entries) {
		if (entry === null || entry === undefined) {
			continue
		}

		if (typeof entry !== 'object') {
			collect(entry)
			continue
		}

		if ('relationTo' in entry && 'value' in entry) {
			const pair = entry as PolymorphicPair
			if (pair.relationTo === collectionSlug) {
				collect(pair.value)
			}
			continue
		}

		if ('id' in entry) {
			collect((entry as { id: unknown }).id)
			continue
		}

		if ('value' in entry) {
			collect((entry as { value: unknown }).value)
		}
	}

	return ids
}

/**
 * The ids as one string, for `useFormFields`: its selector compares what it returns, so a
 * fresh array would count as a change on every render.
 *
 * JSON rather than a separator, because Payload allows custom text ids and any character a
 * separator could use is legal inside one.
 */
export const packChosenIds = (ids: string[]): string => JSON.stringify(ids)

/** The inverse of {@link packChosenIds}. */
export const unpackChosenIds = (packed: string): string[] => JSON.parse(packed) as string[]
