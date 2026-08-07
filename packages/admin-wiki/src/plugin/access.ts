import type { Access } from 'payload'

import type { WikiAccessOptions } from '../options'

/** Default predicate for every operation: any authenticated user, never public. */
export const loggedIn: Access = ({ req }) => Boolean(req.user)

/** Effective access map for the wiki collections: overrides win per operation. */
export const buildWikiAccess = (
	overrides: WikiAccessOptions | undefined
): Required<WikiAccessOptions> => ({
	create: overrides?.create ?? loggedIn,
	delete: overrides?.delete ?? loggedIn,
	read: overrides?.read ?? loggedIn,
	update: overrides?.update ?? loggedIn,
})
