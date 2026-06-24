const TOKEN = /\{\{\s*([^{}|]+?)\s*(?:\|([^{}]*?))?\}\}/g

/**
 * Replace `{{ name }}` and `{{ name|fallback }}` tokens. `resolve` returns the recalled value (''
 * when absent); the fallback (or '') is substituted when `resolve` yields ''. Token-free input is
 * returned unchanged, so this is a no-op for ordinary text.
 */
export const interpolate = (template: string, resolve: (name: string) => string): string =>
	template.replace(TOKEN, (_match, rawName: string, rawFallback?: string) => {
		const value = resolve(rawName.trim())
		if (value !== '') {
			return value
		}
		return rawFallback === undefined ? '' : rawFallback.trim()
	})
