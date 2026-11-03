import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const config: NextConfig = {
	// Next 16.4 writes an AGENTS.md into the app on every dev start; the repo has its own.
	agentRules: false,
	reactStrictMode: true,
	// A proxied vendor route can end in a slash (PostHog's capture endpoints): keep it, unredirected.
	skipTrailingSlashRedirect: true,
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
