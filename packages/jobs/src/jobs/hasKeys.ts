/** An object with at least one key: what counts as content worth showing or keeping. */
export const hasKeys = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && Object.keys(value).length > 0
