import type { Collection, PayloadRequest, TypedUser } from 'payload'

import type { ResolvedIsolatedCollection } from '../types'

/**
 * Warns, in development only, when a user who was just moved onto an isolated cookie can
 * also reach the admin panel.
 *
 * The `isolate` predicate is written by the project, and getting it wrong is silent: an
 * admin classified as a frontend user lands in the wrong cookie, the panel never sees the
 * session, and nothing errors. The two answers are only ever compared here, at login, where
 * a user is being written to a cookie in the first place. Checking on every request would
 * cost an access call per request to say the same thing.
 *
 * Mirrors `canAccessAdmin`'s first branch: the gate is `access.admin` on the collection the
 * user belongs to. Collections that do not define one cannot report anything, so they are
 * skipped rather than guessed about.
 */
export const warnIfAdminMisclassified = async ({
	collection,
	cookieName,
	entry,
	req,
	user,
}: {
	collection: Collection
	/** The cookie the login was actually written to. */
	cookieName: string
	entry: ResolvedIsolatedCollection
	req: PayloadRequest
	user: null | TypedUser | undefined
}): Promise<void> => {
	// biome-ignore lint/plugin/noProcessEnv: a development-only diagnostic, matching how Payload gates its own
	if (cookieName !== entry.cookieName || !user || process.env.NODE_ENV === 'production') {
		return
	}

	const adminAccess = collection.config.access?.admin

	if (!adminAccess) {
		return
	}

	// `access.admin` reads its subject from `req.user`, and the login request itself carries
	// whoever asked for it (usually nobody). The request object is this call's alone, so
	// standing the new user in it for the duration is the least invasive way to ask.
	const previous = req.user

	try {
		req.user = user
		if (await adminAccess({ req })) {
			req.payload.logger.warn(
				`@10x-media/dual-session: user "${user.id}" passes ${collection.config.slug}.access.admin, but \`isolate\` sent their session to the "${entry.cookieName}" cookie, which the admin panel does not read. They will not be able to sign in to it. Check the predicate.`
			)
		}
	} catch {
		// An access function that throws is refusing, which is the classification we expected.
	} finally {
		req.user = previous
	}
}
