import type { Payload } from 'payload'
import type { ReactNode } from 'react'

import type { WikiConvertersFunction, WikiEditorBlockOption } from '../../options'
import { getWikiRegistry } from '../../plugin/registry'
import { MissingBlockRenderer } from '../GuideArticle/MissingBlockRenderer'
import { MissingInlineBlockRenderer } from '../GuideArticle/MissingInlineBlockRenderer'
import { type WikiBlockRenderer, WikiProvider, type WikiVideoPlayerComponent } from './WikiProvider'

export type WikiProviderServerProps = {
	children?: ReactNode
	payload: Payload
}

/**
 * Component paths already reported as missing. This provider renders on every
 * admin request, and an import map is not going to fix itself between two of
 * them, so the warning is worth one line per process rather than one per page
 * view.
 */
const warnedPaths = new Set<string>()

const warnOnce = (payload: Payload, path: string, message: string): void => {
	if (warnedPaths.has(path)) {
		return
	}
	warnedPaths.add(path)
	payload.logger.warn(message)
}

/**
 * Resolve one declared block-to-renderer pairing per slug. A renderer missing
 * from the import map degrades to a visible placeholder instead of silently
 * dropping the block, and the placeholder differs by kind: an inline block sits
 * inside a paragraph, where a block-level element would be invalid markup.
 */
const resolveRenderers = ({
	importMap,
	kind,
	options,
	payload,
}: {
	importMap: Record<string, unknown>
	kind: 'block' | 'inline block'
	options: WikiEditorBlockOption[]
	payload: Payload
}): Record<string, WikiBlockRenderer> => {
	const renderers: Record<string, WikiBlockRenderer> = {}
	for (const option of options) {
		const resolved = importMap[option.component]
		if (resolved) {
			renderers[option.block.slug] = resolved as WikiBlockRenderer
		} else {
			warnOnce(
				payload,
				option.component,
				`@10x-media/admin-wiki: ${kind} renderer "${option.component}" is not in the import map; run importmap generation`
			)
			renderers[option.block.slug] =
				kind === 'block' ? MissingBlockRenderer : MissingInlineBlockRenderer
		}
	}
	return renderers
}

/**
 * Server half of the admin-wide provider: resolves consumer block renderers,
 * the consumer converters function, and the optional video player from the
 * import map (client modules pass across the RSC boundary as references) and
 * hands them to the client provider.
 */
export const WikiProviderServer = ({ children, payload }: WikiProviderServerProps) => {
	const registry = getWikiRegistry(payload.config)
	if (!registry) {
		return children
	}
	const importMap = payload.importMap as Record<string, unknown>
	const blockRenderers = resolveRenderers({
		importMap,
		kind: 'block',
		options: registry.editorBlocks,
		payload,
	})
	const inlineBlockRenderers = resolveRenderers({
		importMap,
		kind: 'inline block',
		options: registry.editorInlineBlocks,
		payload,
	})
	const convertersPath = registry.editorConverters
	const converters = convertersPath
		? (importMap[convertersPath] as undefined | WikiConvertersFunction)
		: undefined
	if (convertersPath && !converters) {
		warnOnce(
			payload,
			convertersPath,
			`@10x-media/admin-wiki: converters "${convertersPath}" are not in the import map; guides render with the plugin's own converters`
		)
	}
	const playerPath = registry.video === false ? undefined : registry.video.playerComponent
	const videoPlayer = playerPath
		? (importMap[playerPath] as undefined | WikiVideoPlayerComponent)
		: undefined
	if (playerPath && !videoPlayer) {
		warnOnce(
			payload,
			playerPath,
			`@10x-media/admin-wiki: video player "${playerPath}" is not in the import map; using the default player`
		)
	}
	return (
		<WikiProvider
			blockChips={registry.chips.blocks}
			blockLabels={registry.blockLabels}
			blockRenderers={blockRenderers}
			converters={converters}
			customTargets={registry.customTargets}
			inlineBlockRenderers={inlineBlockRenderers}
			pagesSlug={registry.slugs.pages}
			videoPlayer={videoPlayer}
			wikiView={registry.wikiView !== false}
			writeAffordances={registry.writeAffordances}
		>
			{children}
		</WikiProvider>
	)
}
