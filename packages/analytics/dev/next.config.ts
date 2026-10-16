import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const config: NextConfig = {
	reactStrictMode: true,
	// A proxied vendor route can end in a slash (PostHog's capture endpoints): keep it, unredirected.
	skipTrailingSlashRedirect: true,
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
