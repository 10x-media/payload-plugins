import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const config: NextConfig = {
	reactStrictMode: true,
	// PostHog's capture endpoints end in a slash, which the docs ask a host proxying it to keep.
	skipTrailingSlashRedirect: true,
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
