// biome-ignore-all lint/plugin/noProcessEnv: next.config is the env boundary for dev
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const allowedDevOrigins = process.env.SITE_URL ? [new URL(process.env.SITE_URL).hostname] : []

const config: NextConfig = {
	reactStrictMode: true,
	allowedDevOrigins,
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
