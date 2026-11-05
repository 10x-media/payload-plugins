'use client'

import type { FrontendBannerData } from '../frontendBanner'
import { ImpersonationFrontendExit } from './ImpersonationFrontendExit'
import './frontendBanner.css'

export type ImpersonationFrontendBannerViewProps = {
	banner: FrontendBannerData | null
	className?: string
	/** Skip the default look. Class names stay, so the project styles everything. */
	unstyled?: boolean
}

/**
 * The frontend banner itself, for any framework: pass what `getFrontendBanner` returned. Renders
 * nothing for `null`. Class names are the styling hook; the default look has zero specificity, so
 * a project class overrides it without `!important`, and `unstyled` drops it.
 */
export const ImpersonationFrontendBannerView = ({
	banner,
	className,
	unstyled,
}: ImpersonationFrontendBannerViewProps) => {
	if (!banner) {
		return null
	}

	const rootClass = [
		'impersonation-frontend-banner',
		unstyled ? null : 'impersonation-frontend-banner--default',
		className,
	]
		.filter(Boolean)
		.join(' ')

	return (
		<div className={rootClass} role="status">
			<span className="impersonation-frontend-banner__text">{banner.actingAs}</span>
			<ImpersonationFrontendExit
				apiPath={banner.apiPath}
				className="impersonation-frontend-banner__exit"
				label={banner.exitLabel}
			/>
		</div>
	)
}
