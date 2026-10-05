import type { Payload } from 'payload'
import type { ReactNode } from 'react'

import type { ViewerOverrides } from '../../options'
import { getRegistry } from '../../plugin/registry'
import type { ViewerMap } from '../../shared/resolveViewer'
import type { DocumentPreviewViewer } from '../../shared/types'
import { DocumentPreviewProvider } from './DocumentPreviewProvider'

export type DocumentPreviewProviderServerProps = {
	children?: ReactNode
	payload: Payload
}

/**
 * Paths already reported as missing. The provider renders on every admin
 * request and an import map does not fix itself between two of them, so one
 * warning per process is enough.
 */
const warnedPaths = new Set<string>()

const resolveViewers = (
	payload: Payload,
	overrides: ViewerOverrides
): ViewerMap<DocumentPreviewViewer> => {
	const importMap = payload.importMap as Record<string, unknown>
	const resolved: ViewerMap<DocumentPreviewViewer> = {}
	for (const [pattern, path] of Object.entries(overrides)) {
		const component = importMap[path]
		if (component) {
			resolved[pattern] = component as DocumentPreviewViewer
		} else if (!warnedPaths.has(path)) {
			warnedPaths.add(path)
			payload.logger.warn(
				`@10x-media/document-preview: viewer "${path}" for "${pattern}" is not in the import map; run importmap generation. The built-in viewer is used meanwhile.`
			)
		}
	}
	return resolved
}

/**
 * Server half of the admin-wide provider: resolves the host's viewer paths from
 * the import map (client modules cross the RSC boundary as references) and hands
 * them to the client provider.
 */
export const DocumentPreviewProviderServer = ({
	children,
	payload,
}: DocumentPreviewProviderServerProps) => {
	const registry = getRegistry(payload.config)
	if (!registry) {
		return children
	}
	const collections: Record<string, ViewerMap<DocumentPreviewViewer>> = {}
	for (const [slug, preview] of Object.entries(registry.collections)) {
		collections[slug] = resolveViewers(payload, preview.viewers)
	}
	return (
		<DocumentPreviewProvider
			collections={collections}
			fileIcons={registry.fileIcons}
			viewers={resolveViewers(payload, registry.viewers)}
		>
			{children}
		</DocumentPreviewProvider>
	)
}
