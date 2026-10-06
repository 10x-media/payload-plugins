'use client'

import { useSettingsOverlayEmbed } from '@10x-media/settings-overlay/client'
import type React from 'react'

/**
 * An eager `component` item: rendered with the page, opens with no round trip.
 *
 * Also the demonstration of `useSettingsOverlayEmbed`, which is how anything inside the panel
 * learns where it is and gets a handle on closing it.
 */
export const DevNotes: React.FC = () => {
	const embed = useSettingsOverlayEmbed()

	return (
		<div style={{ display: 'grid', gap: 16, padding: 20 }}>
			<h4 style={{ margin: 0 }}>Eager component</h4>
			<p style={{ margin: 0, color: 'var(--theme-elevation-600)' }}>
				Rendered on the server with the rest of the page, so opening this row costs no request.
			</p>
			<pre
				style={{
					background: 'var(--theme-elevation-50)',
					borderRadius: 4,
					margin: 0,
					overflowX: 'auto',
					padding: 12,
				}}
			>
				{JSON.stringify(
					embed
						? {
								docID: embed.docID,
								itemSlug: embed.itemSlug,
								itemType: embed.itemType,
								layout: embed.layout,
								overlayId: embed.overlayId,
							}
						: null,
					null,
					2
				)}
			</pre>
			<div>
				<button
					onClick={() => embed?.setTarget({ item: 'tags' })}
					style={{ marginRight: 8 }}
					type="button"
				>
					Go to Tags
				</button>
				<button onClick={() => embed?.close()} type="button">
					Close the panel
				</button>
			</div>
		</div>
	)
}
