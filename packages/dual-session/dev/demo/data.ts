import { AUTH_SCOPE_HEADER } from '@10x-media/dual-session'
import type { Payload } from 'payload'

import { DEMO_NOTE_TITLE } from '../helpers/seed'
import { ADMIN_COOKIE, CUSTOMER_COOKIE, MEMBER_COOKIE, PARTNER_COOKIE } from './cookies'

type ResolvedUser = { collection?: string; email?: string; id?: number | string } | null

const describe = (user: unknown) => {
	const resolved = user as ResolvedUser
	return resolved ? `${resolved.collection} · ${resolved.email ?? resolved.id}` : 'nobody'
}

/** Everything the demo page shows, plain data so a TanStack Start loader can send it. */
export type DemoData = {
	/** Which of the demo's cookies the browser sent. */
	holds: Record<string, boolean>
	/** `req.user` for this request as the proxy or middleware scoped it, and per forced scope. */
	users: { admin: string; frontend: string; live: string }
	note: { lastTouchedBy: string; title: string; touchCount: number }
	/** The plugin's scope header, sent along so the page never imports the plugin's server entry. */
	scopeHeader: string
	settings: { headline: string; lastTouchedBy: string }
}

/**
 * Resolves who the browser is, once per scope, from the page request's own headers. Shared by
 * the Next.js page and the TanStack Start route, which each bring their own `payload`.
 */
export const loadDemoData = async ({
	headers: incoming,
	payload,
}: {
	headers: Headers
	payload: Payload
}): Promise<DemoData> => {
	const withScope = (scope: 'admin' | 'frontend') => {
		const headers = new Headers(incoming)
		headers.set(AUTH_SCOPE_HEADER, scope)
		return headers
	}

	const [live, asAdmin, asFrontend, noteResult, settings] = await Promise.all([
		payload.auth({ headers: new Headers(incoming) }),
		payload.auth({ headers: withScope('admin') }),
		payload.auth({ headers: withScope('frontend') }),
		payload.find({
			collection: 'notes',
			depth: 0,
			limit: 1,
			overrideAccess: true,
			where: { title: { equals: DEMO_NOTE_TITLE } },
		}),
		payload.findGlobal({ slug: 'site-settings', depth: 0, overrideAccess: true }),
	])

	const note = noteResult.docs[0]
	const cookie = incoming.get('cookie') ?? ''
	const held = (name: string) => new RegExp(`(^|;\\s*)${name}=`).test(cookie)

	return {
		holds: Object.fromEntries(
			[ADMIN_COOKIE, CUSTOMER_COOKIE, MEMBER_COOKIE, PARTNER_COOKIE].map((name) => [
				name,
				held(name),
			])
		),
		note: {
			lastTouchedBy: note?.lastTouchedBy ?? 'nobody',
			title: note?.title ?? '',
			touchCount: note?.touchCount ?? 0,
		},
		scopeHeader: AUTH_SCOPE_HEADER,
		settings: {
			headline: settings.headline ?? 'none',
			lastTouchedBy: settings.lastTouchedBy ?? 'nobody',
		},
		users: {
			admin: describe(asAdmin.user),
			frontend: describe(asFrontend.user),
			live: describe(live.user),
		},
	}
}
