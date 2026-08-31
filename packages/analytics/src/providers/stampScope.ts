import type { CollectionBeforeChangeHook } from 'payload'
import type { ProviderAccessArgs } from './access'

const asComparable = (value: unknown): string | null =>
	value === null || value === undefined || value === '' ? null : String(value)

/**
 * Stamps the request's resolved scope onto new provider documents and refuses
 * scope reassignment, so a tenant admin can neither create a provider for
 * another tenant nor move one there. platformRead lifts both restrictions. A
 * value already stamped by an external tenant plugin passes through when it
 * matches the resolved scope (string-compared, so relationship ids work).
 */
export const stampScope = (args: ProviderAccessArgs): CollectionBeforeChangeHook => {
	return async ({ data, operation, originalDoc, req }) => {
		if (!args.scoped || !data) return data
		const incoming = asComparable(data[args.scopeField])
		const platform = await args.platformRead({ req })
		if (platform) return data
		const resolved = await args.resolveScope(req)
		if (operation === 'create') {
			if (incoming === null) {
				if (resolved === null) {
					throw new Error('analytics: no scope resolved for provider create')
				}
				return { ...data, [args.scopeField]: resolved }
			}
			if (incoming !== resolved) {
				throw new Error('analytics: cannot create a provider for another scope')
			}
			return data
		}
		const stored = asComparable(originalDoc?.[args.scopeField])
		if (data[args.scopeField] !== undefined && incoming !== stored) {
			throw new Error('analytics: cannot move a provider to another scope')
		}
		return data
	}
}
