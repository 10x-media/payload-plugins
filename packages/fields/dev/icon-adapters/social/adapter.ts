import { defineIconAdapter } from '@10x-media/fields/icon'
import type { IconAdapter } from '@10x-media/fields/types'

/**
 * A dev-app BYO icon library. Component paths are leading-slash importMap
 * specifiers, which Payload resolves relative to the admin importMap baseDir
 * (the dev app root), so no package subpath is needed.
 */
export const socialAdapter = (): IconAdapter =>
	defineIconAdapter({
		slug: 'social',
		label: 'Social',
		loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
		Icon: '/icon-adapters/social/client#SocialAdapterIcon',
		Assets: '/icon-adapters/social/client#SocialAdapterAssets',
		Nodes: '/icon-adapters/social/client#SocialAdapterNodes',
	})
