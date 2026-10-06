'use client'

import { SettingsRailItems } from '@10x-media/settings-overlay/client'
import type React from 'react'

import './studio.css'

/**
 * A replaced group heading.
 *
 * The rows come from `SettingsRailItems` rather than a hand-rolled loop: it renders whatever the
 * rail would have rendered, including the replaced `RailItem`, and it reads the same
 * search-narrowed list, so a filtered rail stays filtered inside a custom group.
 */
export const StudioRailGroup: React.FC<{ group: { label: null | string } }> = ({ group }) => (
	<section className="studio-group">
		{group.label ? (
			<h3 className="studio-group__label">
				<span className="studio-group__rule" />
				{group.label}
			</h3>
		) : null}
		<SettingsRailItems group={group.label} />
	</section>
)
