import { docs } from 'collections/server'
import { loader } from 'fumadocs-core/source'

export const source = loader({
	baseUrl: '/',
	source: docs.toFumadocsSource(),
})

/**
 * Map page slugs to the `.md` route slugs used by the static markdown endpoint.
 * The leaf segment always carries a `.md` suffix so the emitted file never
 * collides with a same-named directory (e.g. the `analytics` index page vs. the
 * `analytics/` folder holding its children) under `output: 'export'`.
 */
export function slugsToMarkdownPath(slugs: string[]): string[] {
	if (slugs.length === 0) return ['index.md']
	const leaf = slugs[slugs.length - 1] ?? ''
	return [...slugs.slice(0, -1), `${leaf}.md`]
}

/** Inverse of {@link slugsToMarkdownPath}: strip the `.md` suffix back to page slugs. */
export function markdownPathToSlugs(segments: string[]): string[] {
	if (segments.length === 0) return []
	const leaf = (segments[segments.length - 1] ?? '').replace(/\.md$/, '')
	if (segments.length === 1 && leaf === 'index') return []
	return [...segments.slice(0, -1), leaf]
}
