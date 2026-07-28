/** The calculation field's display settings (`decimals`, `prefix`, `suffix` config fields). */
export type CalcDisplayConfig = {
	decimals?: unknown
	prefix?: unknown
	suffix?: unknown
}

const asDecimals = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
		? value
		: undefined

/**
 * Formats a computed calculation value for display: fixed `decimals` when configured, wrapped in
 * `prefix`/`suffix` exactly as authored (no injected spaces; authors control spacing in their
 * strings). Shared by the visitor renderer and the definition's `format` so the frontend, admin
 * answers view, emails, and recall all agree.
 */
export const formatCalcValue = (value: number, config?: CalcDisplayConfig): string => {
	const decimals = asDecimals(config?.decimals)
	const number = decimals !== undefined ? value.toFixed(decimals) : String(value)
	const prefix = typeof config?.prefix === 'string' ? config.prefix : ''
	const suffix = typeof config?.suffix === 'string' ? config.suffix : ''
	return `${prefix}${number}${suffix}`
}
