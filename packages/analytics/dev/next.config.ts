import { analyticsProxyRewrites } from '@10x-media/analytics/next'
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const config: NextConfig = {
	reactStrictMode: true,
	// PostHog capture endpoints use trailing slashes; keep Next from redirecting them.
	skipTrailingSlashRedirect: true,
	async rewrites() {
		return [
			...analyticsProxyRewrites({ provider: 'posthog', region: 'eu' }),
			...analyticsProxyRewrites({ provider: 'plausible' }),
			...analyticsProxyRewrites({ provider: 'umami' }),
		]
	},
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
