'use client'

import { useSettingsOverlayEmbed } from '@10x-media/settings-overlay/client'
import { Button } from '@payloadcms/ui'
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
			<p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
				Rendered on the server with the rest of the page, so opening this row costs no request.
			</p>
			<pre
				style={{
					background: 'var(--color-bg-secondary)',
					borderRadius: 'var(--radius-medium)',
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
			<div style={{ display: 'flex', gap: 'var(--spacer-2)' }}>
				<Button
					buttonStyle="secondary"
					margin={false}
					onClick={() => embed?.setTarget({ item: 'tags' })}
					size="medium"
				>
					Go to Tags
				</Button>
				<Button buttonStyle="secondary" margin={false} onClick={() => embed?.close()} size="medium">
					Close the panel
				</Button>
			</div>
		</div>
	)
}
