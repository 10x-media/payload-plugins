import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { isScopeMember } from '../access/membership'
import type { ProviderAccessArgs } from './access'

const asComparable = (value: unknown): string | null =>
	value === null || value === undefined || value === '' ? null : String(value)

const assertMember = async (
	args: ProviderAccessArgs,
	req: PayloadRequest,
	scope: string
): Promise<void> => {
	if (!(await isScopeMember(args.member, req, scope))) {
		throw new Error('analytics: cannot create a provider in a scope the user does not belong to')
	}
}

/**
 * Stamps the resolved scope on create and refuses a move or a create outside the user's scopes,
 * whatever access the write overrode; the cross-scope grant lifts all of it.
 */
export const stampScope = (args: ProviderAccessArgs): CollectionBeforeChangeHook => {
	return async ({ data, operation, originalDoc, req }) => {
		if (!args.scoped || !data) return data
		const incoming = asComparable(data[args.scopeField])
		if (await args.crossScope({ req })) return data
		const resolved = await args.resolveScope(req)
		if (operation === 'create') {
			if (incoming === null) {
				if (resolved === null) {
					throw new Error('analytics: no scope resolved for provider create')
				}
				await assertMember(args, req, resolved)
				return { ...data, [args.scopeField]: resolved }
			}
			if (incoming !== resolved) {
				throw new Error('analytics: cannot create a provider for another scope')
			}
			await assertMember(args, req, incoming)
			return data
		}
		const stored = asComparable(originalDoc?.[args.scopeField])
		if (data[args.scopeField] !== undefined && incoming !== stored) {
			throw new Error('analytics: cannot move a provider to another scope')
		}
		return data
	}
}
