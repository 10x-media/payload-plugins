import { type GetFrontendBannerArgs, getFrontendBanner } from '../frontendBanner'
import { ImpersonationFrontendBannerView } from './ImpersonationFrontendBannerView'

export type { ImpersonationFrontendBannerLabels } from '../frontendBanner'

export type ImpersonationFrontendBannerProps = GetFrontendBannerArgs & {
	className?: string
	/** Skip the default look. Class names stay, so the project styles everything. */
	unstyled?: boolean
}

/**
 * Default frontend banner, a server component (Next.js). Renders nothing when this request is not
 * the impersonated session. On TanStack Start, use `getFrontendBanner` in a server function and
 * `ImpersonationFrontendBannerView` from `@10x-media/impersonation/client`.
 *
 * ```tsx
 * <ImpersonationFrontendBanner payload={payload} headers={await headers()} />
 * ```
 */
export const ImpersonationFrontendBanner = async ({
	className,
	unstyled,
	...args
}: ImpersonationFrontendBannerProps) => (
	<ImpersonationFrontendBannerView
		banner={await getFrontendBanner(args)}
		className={className}
		unstyled={unstyled}
	/>
)
