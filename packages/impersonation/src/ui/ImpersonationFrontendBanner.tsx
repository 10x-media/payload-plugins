import type { Payload } from 'payload'

import { getImpersonation } from '../getImpersonation'
import { getRegistry } from '../plugin/registry'
import { ImpersonationFrontendExit } from '../ui/ImpersonationFrontendExit'

export type ImpersonationFrontendBannerProps = {
	headers: Headers
	payload: Payload
	user?: null | { collection?: string; id?: number | string }
}

/**
 * Default frontend banner. Renders nothing when this request is not the
 * impersonated session. Own styles, no Payload admin CSS. Drop it in a layout:
 *
 * ```tsx
 * <ImpersonationFrontendBanner payload={payload} headers={await headers()} />
 * ```
 */
export const ImpersonationFrontendBanner = async ({
	headers,
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

	const name = status.target?.id ?? 'user'
	const apiPath = `${payload.config.routes.api}${options.apiPath}`

	return (
		<div
			data-testid="impersonation-frontend-banner"
			role="status"
			style={{
				alignItems: 'center',
				background: '#3d2a12',
				color: '#f3e6d2',
				display: 'flex',
				fontFamily: 'system-ui, sans-serif',
				fontSize: 14,
				gap: 12,
				justifyContent: 'space-between',
				padding: '0.6rem 1rem',
			}}
		>
			<span>
				Impersonation · Acting as {status.target?.collection}/{name}
			</span>
			<ImpersonationFrontendExit apiPath={apiPath} label="Exit" />
		</div>
	)
}
