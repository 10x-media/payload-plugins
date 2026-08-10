export const getAtPath = (obj: Record<string, unknown>, path: string): unknown => {
	const keys = path.split('.')
	let current: unknown = obj
	for (const key of keys) {
		if (current == null || typeof current !== 'object') {
			return undefined
		}
		current = (current as Record<string, unknown>)[key]
	}
	return current
}

export const setAtPath = (obj: Record<string, unknown>, path: string, value: unknown): void => {
	const keys = path.split('.')
	let current = obj
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i]
		if (key === undefined) return
		if (current[key] == null || typeof current[key] !== 'object') {
			current[key] = {}
		}
		current = current[key] as Record<string, unknown>
	}
	const lastKey = keys.at(-1)
	if (lastKey === undefined) return
	current[lastKey] = value
}
