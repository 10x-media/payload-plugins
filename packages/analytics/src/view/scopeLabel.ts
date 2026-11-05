import { PLATFORM_SCOPE } from '../core/contract'
import type { ViewScopes } from './viewProps'

/**
 * True for a scope spanning every tenant: the wildcard, or empty (a request resolving no tenant,
 * which read paths answer install-wide for an aggregate reader and refuse for anyone else).
 */
export const isAllScopes = (scope: string): boolean => scope === PLATFORM_SCOPE || scope === ''

/**
 * Name of the scope the numbers are about: host's `scope.label` where it can, else the id, since
 * nothing else knows what a scope string means.
 */
export const scopeLabel = (scopes: ViewScopes, allLabel: string): string =>
	isAllScopes(scopes.current) ? allLabel : (scopes.ownLabel ?? scopes.current)

/**
 * Whether the view offers the Site select: it needs the reader's own tenant to pick beside every
 * site, and a platform reader resolving no tenant already reads everything.
 */
export const canToggleAggregate = (scopes: ViewScopes): boolean =>
	scopes.canAggregate && !isAllScopes(scopes.own)
