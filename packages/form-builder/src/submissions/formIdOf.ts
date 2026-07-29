/** Narrow a submission's `form` relationship value (raw id or a populated relationship doc) to its id. */
export const formIdOf = (form: unknown): number | string | undefined => {
	if (typeof form === 'number' || typeof form === 'string') {
		return form
	}
	if (form && typeof form === 'object' && 'id' in form) {
		const id = (form as { id: unknown }).id
		if (typeof id === 'number' || typeof id === 'string') {
			return id
		}
	}
	return undefined
}
