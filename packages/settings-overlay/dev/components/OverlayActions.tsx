'use client'

import { SettingsOverlayButton } from '@10x-media/settings-overlay/client'
import { Pill } from '@payloadcms/ui'
import type React from 'react'

import './overlayActions.css'

const panels = [
	{ label: 'System', overlay: 'system' },
	{ label: 'Workspace', overlay: 'workspace' },
	{ label: 'Studio', overlay: 'studio' },
]

/**
 * The same three panels as `OverlayLaunchers`, in the admin header rather than the nav.
 *
 * `admin.components.actions` renders top right of every page and survives with the sidebar
 * hidden, which is what a panel screenshot wants: a panel, rather than a sidebar with a panel
 * beside it. `SettingsOverlayButton` is the plugin's own launcher and draws no chrome, so the
 * Pill is what the reader sees.
 */
export const OverlayActions: React.FC = () => (
	<div className="dev-overlay-actions">
		{panels.map(({ label, overlay }) => (
			<SettingsOverlayButton className="dev-overlay-action" key={overlay} overlay={overlay}>
				<Pill size="small">{label}</Pill>
			</SettingsOverlayButton>
		))}
	</div>
)
