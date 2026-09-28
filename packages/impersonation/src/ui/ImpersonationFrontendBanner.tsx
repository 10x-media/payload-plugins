import type { Payload } from 'payload'

import { getImpersonation } from '../getImpersonation'
import { getRegistry } from '../plugin/registry'
import { ImpersonationFrontendExit } from '../ui/ImpersonationFrontendExit'

export type ImpersonationFrontendBannerLabels = {
	/** `{{name}}` is the target email, or the collection and id when there is no email. */
	actingAs?: string
	exit?: string
}

export type ImpersonationFrontendBannerProps = {
	className?: string
	headers: Headers
	labels?: ImpersonationFrontendBannerLabels
	payload: Payload
	user?: null | { collection?: string; id?: number | string }
}

const fillName = (template: string, name: string): string => template.split('{{name}}').join(name)

/**
 * Default frontend banner. Renders nothing when this request is not the
 * impersonated session. Class names are the styling hook; inline styles are
 * only the unstyled default.
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
	user,
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
	const name = status.targetEmail || fallback
	const actingAs = fillName(labels?.actingAs ?? 'Acting as {{name}}', name)
	const apiPath = `${payload.config.routes.api}${options.apiPath}`
	const rootClass = className
		? `impersonation-frontend-banner ${className}`
		: 'impersonation-frontend-banner'

	return (
		<div className={rootClass} data-testid="impersonation-frontend-banner" role="status">
			<style>
				{`
.impersonation-frontend-banner {
	align-items: center;
	background: #f4f1ea;
	color: #1c1915;
	display: flex;
	font: 14px/1.4 system-ui, sans-serif;
	gap: 12px;
	justify-content: space-between;
	padding: 0.6rem 1rem;
}
.impersonation-frontend-banner__exit {
	background: transparent;
	border: 1px solid currentColor;
	border-radius: 4px;
	color: inherit;
	cursor: pointer;
	font: inherit;
	padding: 0.35rem 0.75rem;
}
`}
			</style>
			<span className="impersonation-frontend-banner__text">{actingAs}</span>
			<ImpersonationFrontendExit
				apiPath={apiPath}
				className="impersonation-frontend-banner__exit"
				label={labels?.exit ?? 'Exit'}
			/>
		</div>
	)
}
