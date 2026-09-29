import type { Payload } from 'payload'

import { getImpersonation } from '../getImpersonation'
import { labelUser } from '../ids'
import { getRegistry } from '../plugin/registry'
import type { UserLabel } from '../types'
import { ImpersonationFrontendExit } from '../ui/ImpersonationFrontendExit'
import './frontendBanner.css'

export type ImpersonationFrontendBannerLabels = {
	/** `{{name}}` is the target per `userLabel`, else collection and id. */
	actingAs?: string
	exit?: string
}

export type ImpersonationFrontendBannerProps = {
	className?: string
	headers: Headers
	labels?: ImpersonationFrontendBannerLabels
	payload: Payload
	/** Skip the default look. Class names stay, so the project styles everything. */
	unstyled?: boolean
	/** Name the target by `useAsTitle` or by email. Defaults to the plugin's `ui.userLabel`. */
	userLabel?: UserLabel
	user?: null | { collection?: string; id?: number | string }
}

const fillName = (template: string, name: string): string => template.split('{{name}}').join(name)

/**
 * Default frontend banner. Renders nothing when this request is not the
 * impersonated session. Class names are the styling hook. The default look
 * has zero specificity, so a project class overrides it without `!important`;
 * `unstyled` drops it.
 *
 * ```tsx
 * <ImpersonationFrontendBanner payload={payload} headers={await headers()} />
 * ```
 */
export const ImpersonationFrontendBanner = async ({
	className,
	headers,
	labels,
	payload,
	unstyled,
	user,
	userLabel,
}: ImpersonationFrontendBannerProps) => {
	const options = getRegistry(payload.config)
	if (!options) {
		return null
	}

	const status = await getImpersonation(
		user !== undefined ? { headers, payload, user: user as never } : { headers, payload }
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
	const actingAs = fillName(labels?.actingAs ?? 'Acting as {{name}}', name)
	const apiPath = `${payload.config.routes.api}${options.apiPath}`
	const rootClass = [
		'impersonation-frontend-banner',
		unstyled ? null : 'impersonation-frontend-banner--default',
		className,
	]
		.filter(Boolean)
		.join(' ')

	return (
		<div className={rootClass} role="status">
			<span className="impersonation-frontend-banner__text">{actingAs}</span>
			<ImpersonationFrontendExit
				apiPath={apiPath}
				className="impersonation-frontend-banner__exit"
				label={labels?.exit ?? 'Exit'}
			/>
		</div>
	)
}
