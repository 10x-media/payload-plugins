export const extractTenantId = (val: unknown): string | number | null => {
	if (val == null) return null
	if (typeof val === 'string' || typeof val === 'number') return val
	if (typeof val === 'object' && 'id' in (val as object)) {
		return (val as Record<string, unknown>).id as string | number
	}
	return null
}
