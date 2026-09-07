'use client'

import { AnimateHeight, ChevronIcon, SearchIcon, usePreferences } from '@payloadcms/ui'
import React, { use, useState } from 'react'

import { PREFERENCE_KEY } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ManifestGroup } from '../types'
import { useSettingsBadge } from './badges'
import { SettingsRailContext, useSettingsItemState, useSettingsPanel } from './context'
import { type OverlaySlots, UNGROUPED_KEY } from './slots'

const base = 'settings-overlay'

/**
 * One rail row, drawn from context alone. Exported so a `RailGroup` replacement can place the
 * default rows around its own heading instead of reimplementing them, and so the default rail
 * and a replacement can never drift apart.
 */
export const SettingsRailItem: React.FC<{ slug: string }> = ({ slug }) => {
	const state = useSettingsItemState(slug)
	const badge = useSettingsBadge(slug)
	const rail = use(SettingsRailContext)

	if (!state) {
		return null
	}

	const replacement = rail?.itemSlots[slug]
	if (replacement) {
		return <li>{replacement}</li>
	}

	const { icon, isActive, item, select } = state

	return (
		<li>
			<button
				aria-current={isActive ? 'page' : undefined}
				className={[`${base}__rail-item`, isActive && `${base}__rail-item--active`]
					.filter(Boolean)
					.join(' ')}
				onClick={select}
				type="button"
			>
				{icon ? <span className={`${base}__rail-icon`}>{icon}</span> : null}
				<span className={`${base}__rail-label`}>{item.label}</span>
				{badge === undefined ? null : <span className={`${base}__badge`}>{badge}</span>}
			</button>
		</li>
	)
}

/** Every visible row of one group, in order. The building block for a `RailGroup` replacement. */
export const SettingsRailItems: React.FC<{ group?: null | string }> = ({ group = null }) => {
	const { visibleGroups } = useSettingsPanel()
	const match = visibleGroups.find((candidate) => candidate.label === (group || null))

	return (
		<ul className={`${base}__rail-items`}>
			{(match?.items ?? []).map((item) => (
				<SettingsRailItem key={item.slug} slug={item.slug} />
			))}
		</ul>
	)
}

/**
 * A rail group, collapsible the way the admin's own nav groups are.
 *
 * The initial state comes from the manifest, which the server resolved from the reader's stored
 * preference, so the rail opens in the state they left it rather than opening everything and
 * folding it a moment later. Toggling writes back under this plugin's own preference key.
 *
 * The ungrouped block has no heading, so there is nothing to collapse it by and it always
 * renders open.
 *
 * A consumer who wants groups that never collapse replaces the `RailGroup` slot; that is why
 * there is no option for it.
 */
const DefaultGroup: React.FC<{ group: ManifestGroup; overlayId: string }> = ({
	group,
	overlayId,
}) => {
	// While a search is running every group is open, and there is nothing to collapse.
	const { filtering } = useSettingsPanel()
	const { setPreference } = usePreferences()
	const [stored, setStored] = useState(group.open !== false)
	const open = filtering || stored
	// The first render must match the server's, so the height animation is armed only once the
	// reader has actually toggled something.
	const [animate, setAnimate] = useState(false)

	const rows = (
		<ul className={`${base}__rail-items`}>
			{group.items.map((item) => (
				<SettingsRailItem key={item.slug} slug={item.slug} />
			))}
		</ul>
	)

	// The ungrouped block has no heading, so there is nothing to collapse it by. Same while a
	// search is running: the rail already shows only matches, and a toggle that reopened itself
	// on the next keystroke would be a dead control.
	if (!group.label || filtering) {
		return <div className={`${base}__rail-group`}>{rows}</div>
	}

	const label = group.label

	const toggle = () => {
		const next = !stored
		setAnimate(true)
		setStored(next)
		void setPreference(
			PREFERENCE_KEY,
			{ [overlayId]: { groups: { [label]: { open: next } } } },
			true
		)
	}

	return (
		<div
			className={[`${base}__rail-group`, !open && `${base}__rail-group--collapsed`]
				.filter(Boolean)
				.join(' ')}
		>
			<button
				aria-expanded={open}
				className={`${base}__rail-group-toggle`}
				onClick={toggle}
				type="button"
			>
				<span className={`${base}__rail-group-label`}>{label}</span>
				<ChevronIcon
					className={`${base}__rail-group-indicator`}
					direction={open ? 'up' : undefined}
				/>
			</button>
			<AnimateHeight duration={animate ? 200 : 0} height={open ? 'auto' : 0}>
				{rows}
			</AnimateHeight>
		</div>
	)
}

/**
 * The rail's filter box.
 *
 * `type="search"` so the browser offers its own clear affordance and Escape empties the field,
 * both for free and both already familiar.
 */
const DefaultSearch: React.FC = () => {
	const { overlay, search, setSearch } = useSettingsPanel()
	const { t } = useTranslation()
	const label = t(keys.searchPlaceholder)

	return (
		<search className={`${base}__search`}>
			<span className={`${base}__search-icon`}>
				<SearchIcon />
			</span>
			<input
				aria-label={label}
				className={`${base}__search-input`}
				id={`${base}-search-${overlay.id}`}
				onChange={(event) => {
					setSearch(event.target.value)
				}}
				placeholder={label}
				type="search"
				value={search}
			/>
		</search>
	)
}

/**
 * The left rail: an optional search box, then the groups in manifest order with the ungrouped
 * block first.
 *
 * Search narrows the rail only. The open pane stays open even once its row stops matching, so
 * typing never yanks the panel out from under somebody mid-read.
 */
export const SettingsRail: React.FC<{
	overlayIcon: React.ReactNode
	slots?: OverlaySlots
}> = ({ overlayIcon, slots }) => {
	const { manifest, overlay, visibleGroups } = useSettingsPanel()
	const { t } = useTranslation()

	if (slots?.Rail) {
		return <>{slots.Rail}</>
	}

	const hasItems = manifest.groups.some((group) => group.items.length > 0)

	return (
		<nav aria-label={manifest.label} className={`${base}__rail`}>
			<h2 className={`${base}__rail-title`}>
				{overlayIcon ? <span className={`${base}__rail-icon`}>{overlayIcon}</span> : null}
				<span>{manifest.label}</span>
			</h2>
			{overlay.searchable ? (slots?.Search ?? <DefaultSearch />) : null}
			<div className={`${base}__rail-scroll`}>
				{visibleGroups.map((group) => {
					const key = group.label ?? UNGROUPED_KEY
					const slot = slots?.RailGroup?.[key]
					return slot ? (
						<React.Fragment key={key}>{slot}</React.Fragment>
					) : (
						<DefaultGroup group={group} key={key} overlayId={overlay.id} />
					)
				})}
				{visibleGroups.length === 0 ? (
					<p className={`${base}__rail-empty`}>{t(hasItems ? keys.noResults : keys.empty)}</p>
				) : null}
			</div>
		</nav>
	)
}
