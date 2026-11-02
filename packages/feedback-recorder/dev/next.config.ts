import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const config: NextConfig = {
	reactStrictMode: true,
}

export default withPayload(config, {
	devBundleServerPackages: false,
})
