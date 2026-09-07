'use client'

import { useSettingsPanel } from '@10x-media/settings-overlay/client'
import type React from 'react'

import './studio.css'

/**
 * A replaced search box, with a match count the default one does not show.
 *
 * `visibleGroups` is the already-narrowed list, so counting it needs no second filter pass and
 * cannot disagree with what the rail is showing.
 */
export const StudioSearch: React.FC = () => {
	const { search, setSearch, visibleGroups } = useSettingsPanel()
	const count = visibleGroups.reduce((total, group) => total + group.items.length, 0)

	return (
		<div className="studio-search">
			<input
				aria-label="Filter"
				className="studio-search__input"
				onChange={(event) => {
					setSearch(event.target.value)
				}}
				placeholder="Filter"
				type="search"
				value={search}
			/>
			{search ? <span className="studio-search__count">{count}</span> : null}
		</div>
	)
}
