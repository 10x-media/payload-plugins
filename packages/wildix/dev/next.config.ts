import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const config: NextConfig = {
	reactStrictMode: true,
	// ngrok (and similar tunnels) are cross-origin vs localhost; without this, Next
	// blocks /_next/* in dev and the admin UI renders as a white page.
	allowedDevOrigins: [
		'grain-reverse-gluten.ngrok-free.dev',
		'*.ngrok-free.dev',
		'*.ngrok-free.app',
	],
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
