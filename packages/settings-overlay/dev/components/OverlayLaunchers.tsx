'use client'

import { useSettingsOverlay } from '@10x-media/settings-overlay/client'
import type React from 'react'

const buttonStyle: React.CSSProperties = {
	background: 'var(--color-bg-secondary)',
	border: 'var(--stroke-width-small) solid var(--color-border)',
	borderRadius: 'var(--radius-medium)',
	color: 'inherit',
	cursor: 'pointer',
	font: 'inherit',
	padding: '6px 10px',
	textAlign: 'start',
	width: '100%',
}

/**
 * Nav buttons that open the panels, mounted through `admin.components.beforeNavLinks`.
 *
 * The plugin ships no sidebar integration on purpose: it gives you `useSettingsOverlay()` and
 * you write the button. This is that button, and the deep links below it are the same targets
 * spelled as URLs, for checking that a pasted link reopens the same thing.
 */
export const OverlayLaunchers: React.FC = () => {
	const settings = useSettingsOverlay()

	return (
		<div style={{ display: 'grid', gap: 6, padding: '0 var(--spacer-3) var(--spacer-3)' }}>
			<button onClick={() => settings.toggle('system')} style={buttonStyle} type="button">
				Open system settings
			</button>
			<button
				onClick={() => settings.open('system', { item: 'tags' })}
				style={buttonStyle}
				type="button"
			>
				Open system, on Tags
			</button>
			<button onClick={() => settings.toggle('workspace')} style={buttonStyle} type="button">
				Open workspace (wide, searchable)
			</button>
			<button onClick={() => settings.toggle('studio')} style={buttonStyle} type="button">
				Open studio (every slot replaced)
			</button>
			<a href="?settings=system/branding" style={{ ...buttonStyle, display: 'block' }}>
				Deep link: system/branding
			</a>
			<a href="?settings=system/stats" style={{ ...buttonStyle, display: 'block' }}>
				Deep link: system/stats (lazy)
			</a>
			<a href="?settings=system/gone/999" style={{ ...buttonStyle, display: 'block' }}>
				Deep link: a stale target
			</a>
		</div>
	)
}
