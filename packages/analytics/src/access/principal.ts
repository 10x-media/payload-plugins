/**
 * Trusted principal for server code reading a scope it names, skipping `access.read` and
 * membership. Request data cannot carry a symbol, so no request can produce it.
 *
 * @beta
 */
export const SYSTEM: unique symbol = Symbol.for('@10x-media/analytics/system')

/** `Symbol.for`, so every copy of the bundle agrees on it; request data cannot carry a symbol. */
const GATED: unique symbol = Symbol.for('@10x-media/analytics/gated-scope')

/**
 * A scope one request was cleared to act on. Only `resolveRequestedScope` mints one, so a read
 * handed one never asks again.
 *
 * @beta
 */
export interface GatedScope {
	readonly [GATED]: true
	/** A tenant, null for the install-wide scope, or `'*'` for every scope at once. */
	readonly value: string | null
}

/**
 * @internal `resolveRequestedScope` is the one caller, which `principal.test.ts` holds every
 * other module to.
 */
export const mintGatedScope = (value: string | null): GatedScope => ({ [GATED]: true, value })

/** Whether `value` is a token `resolveRequestedScope` minted, checked at runtime, not by type. */
export const isGatedScope = (value: unknown): value is GatedScope =>
	typeof value === 'object' &&
	value !== null &&
	Reflect.get(value, GATED) === true &&
	(typeof Reflect.get(value, 'value') === 'string' || Reflect.get(value, 'value') === null)

/**
 * Who a read answers to: a reader, whose `scope` is gated like an endpoint's `scope` parameter or
 * already a {@link GatedScope}, or {@link SYSTEM}.
 *
 * @beta
 */
export type ReadPrincipal =
	| { principal?: undefined; scope?: GatedScope | string | null }
	| { principal: typeof SYSTEM; scope: string | null }

/** The principal half of a read's arguments, for a helper that hands it to the read below it. */
export const readPrincipalOf = (args: ReadPrincipal): ReadPrincipal =>
	args.principal === SYSTEM
		? { principal: SYSTEM, scope: args.scope }
		: args.scope === undefined
			? {}
			: { scope: args.scope }
