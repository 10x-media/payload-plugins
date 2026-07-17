import type { IconAdapter } from '../../../../types'

/** Tabler adapter (outline set). Requires the optional `@tabler/icons-react` peer to render glyphs. */
export const tablerAdapter = (): IconAdapter => ({
	slug: 'tabler',
	label: 'Tabler',
	loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
	Icon: '@10x-media/fields/icon/adapters/tabler#TablerAdapterIcon',
	Assets: '@10x-media/fields/icon/adapters/tabler#TablerAdapterAssets',
	version: 1,
})
