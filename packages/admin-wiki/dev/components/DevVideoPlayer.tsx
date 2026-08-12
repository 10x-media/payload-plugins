'use client'

import type { WikiVideoPlayerProps } from '@10x-media/admin-wiki/client'

/**
 * Consumer video player wired through `video.playerComponent`, here only to
 * prove the contract: it replaces the built-in player everywhere a wiki video
 * renders (the editor card, the guide drawers, the wiki view), and it receives
 * the whole `wiki-media` document. Loud on purpose, so the override is obvious
 * without playing anything.
 */
export const DevVideoPlayer = ({ media }: WikiVideoPlayerProps) => (
	<div
		style={{
			background: 'var(--theme-elevation-50)',
			border: '2px dashed var(--theme-success-500)',
			borderRadius: '4px',
			display: 'grid',
			gap: '0.5rem',
			padding: '0.75rem',
		}}
	>
		<strong style={{ color: 'var(--theme-success-600)' }}>Dev player (consumer component)</strong>
		<code style={{ fontSize: '0.8125rem' }}>
			#{media.id} · {media.filename ?? 'no filename'} · {media.mimeType ?? 'no mimeType'}
		</code>
		{media.url ? (
			<video
				controls
				preload="metadata"
				src={media.url}
				style={{ borderRadius: '4px', width: '100%' }}
			>
				<track kind="captions" />
			</video>
		) : (
			<span>No file on this document.</span>
		)}
	</div>
)
