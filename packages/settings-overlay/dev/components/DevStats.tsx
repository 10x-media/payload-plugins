import type { SettingsOverlayItemServerProps } from '@10x-media/settings-overlay/types'

/**
 * A lazy `component` item: a server component that reads the database, so it must not run on
 * every page load. Marked `lazy: true` in the config, which routes it through the same channel
 * as a `view` item and gives it a real request.
 */
export const DevStats = async (props: Partial<SettingsOverlayItemServerProps>) => {
	const { req, settingsOverlayEmbed } = props

	if (!req) {
		return <p style={{ padding: 20 }}>No request; this component only renders inside the panel.</p>
	}

	const [tags, posts, redirects] = await Promise.all([
		req.payload.count({ collection: 'tags' }),
		req.payload.count({ collection: 'posts' }),
		req.payload.count({ collection: 'redirects' }),
	])

	return (
		<div style={{ display: 'grid', gap: 16, padding: 20 }}>
			<h4 style={{ margin: 0 }}>Lazy server component</h4>
			<p style={{ margin: 0, color: 'var(--theme-elevation-600)' }}>
				Fetched on open through `render-widget`, with a real request. Counted at{' '}
				{new Date().toLocaleTimeString()} for {req.user?.email ?? 'nobody'}.
			</p>
			<ul style={{ margin: 0, paddingInlineStart: 20 }}>
				<li>tags: {tags.totalDocs}</li>
				<li>posts: {posts.totalDocs}</li>
				<li>redirects: {redirects.totalDocs}</li>
			</ul>
			<pre
				style={{
					background: 'var(--theme-elevation-50)',
					borderRadius: 4,
					margin: 0,
					padding: 12,
				}}
			>
				{JSON.stringify(settingsOverlayEmbed ?? null, null, 2)}
			</pre>
		</div>
	)
}
