import type { Payload } from 'payload'
import type { ReactNode } from 'react'

import { getWikiRegistry } from '../../plugin/registry'
import { MissingBlockRenderer } from '../GuideArticle/MissingBlockRenderer'
import { type WikiBlockRenderer, WikiProvider, type WikiVideoPlayerComponent } from './WikiProvider'

export type WikiProviderServerProps = {
	children?: ReactNode
	payload: Payload
}

/**
 * Server half of the admin-wide provider: resolves consumer block renderers
 * and the optional video player from the import map (client components pass
 * across the RSC boundary as references) and hands them to the client
 * provider. A declared renderer missing from the import map degrades to a
 * visible placeholder instead of silently dropping the block.
 */
export const WikiProviderServer = ({ children, payload }: WikiProviderServerProps) => {
	const registry = getWikiRegistry(payload.config)
	if (!registry) {
		return children
	}
	const importMap = payload.importMap as Record<string, unknown>
	const blockRenderers: Record<string, WikiBlockRenderer> = {}
	for (const option of registry.editorBlocks) {
		const resolved = importMap[option.component]
		if (resolved) {
			blockRenderers[option.block.slug] = resolved as WikiBlockRenderer
		} else {
			payload.logger.warn(
				`@10x-media/admin-wiki: block renderer "${option.component}" is not in the import map; run importmap generation`
			)
			blockRenderers[option.block.slug] = MissingBlockRenderer
		}
	}
	const playerPath = registry.video === false ? undefined : registry.video.playerComponent
	const videoPlayer = playerPath
		? (importMap[playerPath] as undefined | WikiVideoPlayerComponent)
		: undefined
	if (playerPath && !videoPlayer) {
		payload.logger.warn(
			`@10x-media/admin-wiki: video player "${playerPath}" is not in the import map; using the default player`
		)
	}
	return (
		<WikiProvider
			blockRenderers={blockRenderers}
			pagesSlug={registry.slugs.pages}
			videoPlayer={videoPlayer}
			wikiView={registry.wikiView}
			writeAffordances={registry.writeAffordances}
		>
			{children}
		</WikiProvider>
	)
}
