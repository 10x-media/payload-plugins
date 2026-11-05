import type { Payload, User } from 'payload'

import { getImpersonation } from './getImpersonation'
import { labelUser } from './ids'
import { getRegistry } from './plugin/registry'
import type { UserLabel } from './types'

export type ImpersonationFrontendBannerLabels = {
	/** `{{name}}` is the target per `userLabel`, else collection and id. */
	actingAs?: string
	exit?: string
}

export type GetFrontendBannerArgs = {
	headers: Headers
	labels?: ImpersonationFrontendBannerLabels
	payload: Payload
	/** Skip a second `payload.auth` when the caller already resolved the user. */
	user?: null | { collection?: string; id?: number | string }
	/** Name the target by `useAsTitle` or by email. Defaults to the plugin's `ui.userLabel`. */
	userLabel?: UserLabel
}

/** What `ImpersonationFrontendBannerView` renders: plain data, so a loader can send it to the client. */
export type FrontendBannerData = {
	actingAs: string
	apiPath: string
	exitLabel: string
}

const fillName = (template: string, name: string): string => template.split('{{name}}').join(name)

/**
 * The frontend banner's data for this request, or `null` when it is not the impersonated session.
 * `ImpersonationFrontendBanner` (Next.js, server component) calls it for you; on TanStack Start,
 * call it in a server function and render `ImpersonationFrontendBannerView` with the result.
 */
export const getFrontendBanner = async ({
	headers,
	labels,
	payload,
	user,
	userLabel,
}: GetFrontendBannerArgs): Promise<FrontendBannerData | null> => {
	const options = getRegistry(payload.config)
	if (!options) {
		return null
	}

	const status = await getImpersonation(
		user !== undefined ? { headers, payload, user: user as User | null } : { headers, payload }
	)
	if (!status.active || status.side !== 'target') {
		return null
	}

	const fallback = status.target ? `${status.target.collection}/${status.target.id}` : 'user'
	const name =
		labelUser(userLabel ?? options.ui.userLabel, {
			email: status.targetEmail,
			title: status.targetTitle,
		}) ?? fallback

	return {
		actingAs: fillName(labels?.actingAs ?? 'Acting as {{name}}', name),
		apiPath: `${payload.config.routes.api}${options.apiPath}`,
		exitLabel: labels?.exit ?? 'Exit',
	}
}
