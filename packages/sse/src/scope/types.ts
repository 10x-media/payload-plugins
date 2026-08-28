import type { PayloadRequest } from 'payload'

/** Broker channel that receives every scoped publish of a given public topic. */
export const SCOPE_WILDCARD = '*'

/**
 * The scopes a subscriber is allowed to receive.
 * `null` means the request has no scope and must be refused when scoping is on.
 * `'*'` is every scope (platform admin). An array is a union of concrete scopes.
 */
export type ScopeSelection = string | string[] | typeof SCOPE_WILDCARD | null

export type ResolveRequestScope = (args: {
	req: PayloadRequest
}) => ScopeSelection | Promise<ScopeSelection>

export type ResolveDocScope = (args: {
	doc: unknown
	req?: PayloadRequest
}) => string | null | Promise<string | null>

export type SSEScopeOptions = {
	resolveRequest: ResolveRequestScope
	resolveDoc: ResolveDocScope
}
