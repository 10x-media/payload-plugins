import {
	type FrontendBannerData,
	getFrontendBanner,
	getImpersonation,
} from '@10x-media/impersonation'
import type { Payload } from 'payload'

type ResolvedUser = { collection?: string; email?: string; id?: number | string } | null

/** Everything the demo page shows, plain data so a TanStack Start loader can send it. */
export type DemoData = {
	banner: FrontendBannerData | null
	/** `impersonating as <collection>/<id>` or `not impersonating`. */
	status: string
	/** `req.user` for this request. */
	user: string
}

/**
 * Resolves who the browser is and whether it is impersonated, from the page request's own
 * headers. Shared by the Next.js page and the TanStack Start route, which each bring `payload`.
 */
export const loadDemoData = async ({
	headers,
	payload,
}: {
	headers: Headers
	payload: Payload
}): Promise<DemoData> => {
	const { user } = await payload.auth({ headers })
	const impersonation = await getImpersonation({ headers, payload, user })
	const resolved = user as ResolvedUser

	return {
		banner: await getFrontendBanner({ headers, payload, user }),
		status: impersonation.active
			? `impersonating as ${impersonation.target?.collection}/${impersonation.target?.id}`
			: 'not impersonating',
		user: resolved ? `${resolved.collection} · ${resolved.email ?? resolved.id}` : 'nobody',
	}
}
