'use client'

import { ReactSelect, SearchIcon } from '@payloadcms/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import type React from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations'
import { useTranslation } from '../../../translations/useTranslation'
import type { IconManifest, IconMeta, IconNodeMap } from '../../../types'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { buildIconSearchIndex, searchIcons } from '../shared/search'
import { IconGridCell } from './IconGridCell'
import { useRecentIcons } from './useRecentIcons'

// One fixed size drives both the column count and the virtualizer row height. With no
// in-flow label to vary a cell's height, every cell is an identical square and the grid
// stays aligned regardless of icon name length.
const CELL_SIZE = 64
const RECENT = '__recent__'
const ALL = '__all__'

export type IconDrawerContentProps = {
	activeLibrary: string
	adapterComponents: Record<string, AdapterComponentsEntry>
	/** Libraries available for selection: registered adapters already intersected with `available`. */
	adapters: { label: string; slug: string }[]
	onLibraryChange: (slug: string) => void
	onSelect: (library: string, icon: IconMeta) => void
	selected: { library: string; name: string } | null
	slugPrefix: string
}

const IconDrawerContent: React.FC<IconDrawerContentProps> = ({
	activeLibrary,
	adapterComponents,
	adapters,
	onLibraryChange,
	onSelect,
	selected,
	slugPrefix,
}) => {
	const { i18n, t } = useTranslation()
	const [manifests, setManifests] = useState<Map<string, IconManifest>>(() => new Map())
	const [nodeMaps, setNodeMaps] = useState<Map<string, IconNodeMap>>(() => new Map())
	const [query, setQuery] = useState('')
	const deferredQuery = useDeferredValue(query)
	const [category, setCategory] = useState<string>(ALL)
	const { addRecent, recent } = useRecentIcons(activeLibrary)

	const manifest = manifests.get(activeLibrary)
	const entry = adapterComponents[activeLibrary]
	const Assets = entry?.Assets
	const NodesLoader = entry?.Nodes
	const nodeMap = nodeMaps.get(activeLibrary)
	// Libraries with a Nodes loader render the grid from bulk node-data; the grid
	// waits for that data before showing cells, others (radix) render immediately.
	const nodesPending = Boolean(NodesLoader) && !nodeMap
	const loading = !manifest || nodesPending

	const handleManifest = useCallback(
		(loaded: IconManifest) => {
			setManifests((previous) => new Map(previous).set(activeLibrary, loaded))
		},
		[activeLibrary]
	)

	const handleNodes = useCallback(
		(loaded: IconNodeMap) => {
			setNodeMaps((previous) => new Map(previous).set(activeLibrary, loaded))
		},
		[activeLibrary]
	)

	// biome-ignore lint/correctness/useExhaustiveDependencies: activeLibrary is the trigger; the effect resets category and search when it changes
	useEffect(() => {
		setCategory(ALL)
		setQuery('')
	}, [activeLibrary])

	const byName = useMemo(
		() => new Map((manifest?.icons ?? []).map((icon) => [icon.name, icon])),
		[manifest]
	)

	const categoryIcons = useMemo((): IconMeta[] => {
		if (!manifest) return []
		if (category === ALL) return manifest.icons
		if (category === RECENT) {
			return recent
				.map((name) => byName.get(name))
				.filter((icon): icon is IconMeta => Boolean(icon))
		}
		return manifest.icons.filter((icon) => icon.categories.includes(category))
	}, [byName, category, manifest, recent])

	const index = useMemo(() => buildIconSearchIndex(categoryIcons), [categoryIcons])
	const visible = useMemo(() => searchIcons(index, deferredQuery), [deferredQuery, index])

	const gridRef = useRef<HTMLDivElement>(null)
	const [gridWidth, setGridWidth] = useState(0)
	useEffect(() => {
		const element = gridRef.current
		if (!element) return
		const observer = new ResizeObserver(() => setGridWidth(element.offsetWidth))
		observer.observe(element)
		setGridWidth(element.offsetWidth)
		return () => observer.disconnect()
	}, [])
	const columns = Math.max(3, Math.floor(gridWidth / CELL_SIZE))
	const rowCount = Math.ceil(visible.length / columns)
	// Cell-box span of a full row (columns * CELL_SIZE), published to CSS as a custom property.
	// The header row and banner derive their width from this (inset to the button outlines in
	// icon-field.css) so the search, switcher, banner, and visible grid share one left and one
	// right edge. Sized only from CELL_SIZE.
	const mainStyle = {
		'--tenx-icon-grid-width': `${columns * CELL_SIZE}px`,
	} as React.CSSProperties

	const virtualizer = useVirtualizer({
		count: rowCount,
		estimateSize: () => CELL_SIZE,
		getScrollElement: () => gridRef.current,
		// Cells are cheap inline SVG now, so a deeper overscan buys smoother fast scrolls.
		overscan: 8,
	})

	const [focusIndex, setFocusIndex] = useState(0)
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset focus whenever the visible set changes
	useEffect(() => setFocusIndex(0), [activeLibrary, category, deferredQuery])
	const cellRefs = useRef(new Map<number, HTMLButtonElement>())
	const registerRef = useCallback((cellIndex: number, element: HTMLButtonElement | null) => {
		if (element) cellRefs.current.set(cellIndex, element)
		else cellRefs.current.delete(cellIndex)
	}, [])

	const focusCell = useCallback(
		(cellIndex: number) => {
			virtualizer.scrollToIndex(Math.floor(cellIndex / columns))
			requestAnimationFrame(() => cellRefs.current.get(cellIndex)?.focus())
		},
		[columns, virtualizer]
	)

	const handleGridKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const max = visible.length - 1
			if (max < 0) return
			let next: number | null = null
			if (event.key === 'ArrowRight') next = Math.min(focusIndex + 1, max)
			else if (event.key === 'ArrowLeft') next = Math.max(focusIndex - 1, 0)
			else if (event.key === 'ArrowDown') next = Math.min(focusIndex + columns, max)
			else if (event.key === 'ArrowUp') next = Math.max(focusIndex - columns, 0)
			else if (event.key === 'Home') next = 0
			else if (event.key === 'End') next = max
			if (next === null) return
			event.preventDefault()
			setFocusIndex(next)
			focusCell(next)
		},
		[columns, focusCell, focusIndex, visible.length]
	)

	const handleSelect = useCallback(
		(icon: IconMeta) => {
			addRecent(icon.name)
			onSelect(activeLibrary, icon)
		},
		[activeLibrary, addRecent, onSelect]
	)

	const railItems = useMemo(
		(): { key: string; label: string }[] => [
			{ key: ALL, label: t(keys.allIcons) },
			{ key: RECENT, label: t(keys.recent) },
			...(manifest?.categories ?? []).map((name) => ({ key: name, label: name })),
		],
		[manifest, t]
	)

	const libraryOptions = useMemo(
		() => adapters.map((adapter) => ({ label: adapter.label, value: adapter.slug })),
		[adapters]
	)
	const librarySelectId = `${slugPrefix}-library`

	// The stored value points at a library that is no longer offered for selection; the
	// full explanation lives here, the trigger only carries a compact marker.
	const selectedUnavailable =
		selected !== null && !adapters.some((adapter) => adapter.slug === selected.library)

	// A listbox must own option children, so the grid only claims role="listbox" (with
	// its keyboard nav and label) once cells exist. While loading it is an aria-busy
	// container; when empty it is a plain container holding the "no icons" message.
	const gridPopulated = !loading && visible.length > 0
	const gridA11y: React.HTMLAttributes<HTMLDivElement> = gridPopulated
		? { 'aria-label': t(keys.iconGrid), onKeyDown: handleGridKeyDown, role: 'listbox' }
		: { 'aria-busy': loading || undefined }

	return (
		<div className="tenx-icon-drawer">
			{/* Sibling loaders keyed distinctly per library: a shared key collides ("two children
			    with the same key") when both mount on open, while distinct keys keep the per-library remount. */}
			{Assets && !manifest ? (
				<Assets key={`assets-${activeLibrary}`} onReady={handleManifest} />
			) : null}
			{NodesLoader && !nodeMap ? (
				<NodesLoader key={`nodes-${activeLibrary}`} onReady={handleNodes} />
			) : null}
			<div className="tenx-icon-drawer__body">
				<nav aria-label={t(keys.iconCategories)} className="tenx-icon-drawer__rail">
					{railItems.map((item) => (
						<button
							className={
								category === item.key
									? 'tenx-icon-drawer__rail-item tenx-icon-drawer__rail-item--active'
									: 'tenx-icon-drawer__rail-item'
							}
							key={item.key}
							onClick={() => setCategory(item.key)}
							type="button"
						>
							{item.label}
						</button>
					))}
				</nav>
				<div className="tenx-icon-drawer__main" style={mainStyle}>
					{selectedUnavailable ? (
						<div className="tenx-icon-drawer__banner" role="status">
							{t(keys.libraryUnavailable)}
						</div>
					) : null}
					<div className="tenx-icon-drawer__header">
						{/* Bordered control mirrors Payload's list-view search: SearchIcon inside-left, borderless input. */}
						<div className="tenx-icon-drawer__search">
							<span aria-hidden="true" className="tenx-icon-drawer__search-icon">
								<SearchIcon />
							</span>
							<input
								aria-label={t(keys.searchIcons)}
								className="tenx-icon-drawer__search-input"
								onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
									setQuery(event.target.value)
								}
								placeholder={t(keys.searchIcons)}
								type="text"
								value={query}
							/>
						</div>
						{/* adapters is the available-filtered set; the switcher shows only with 2+ libraries, fixed width beside the growing search */}
						{adapters.length > 1 ? (
							<div className="tenx-icon-drawer__switcher">
								<label className="tenx-icon-drawer__sr-only" htmlFor={librarySelectId}>
									{t(keys.fieldIconLibraryLabel)}
								</label>
								<ReactSelect
									inputId={librarySelectId}
									isClearable={false}
									onChange={(option) => {
										const single = Array.isArray(option) ? option[0] : option
										if (single && typeof single.value === 'string') onLibraryChange(single.value)
									}}
									options={libraryOptions}
									value={libraryOptions.find((option) => option.value === activeLibrary)}
								/>
							</div>
						) : null}
					</div>
					<div className="tenx-icon-drawer__grid" ref={gridRef} {...gridA11y}>
						{loading ? (
							<div className="tenx-icon-drawer__loading">
								{Array.from({ length: 24 }, (_, skeletonIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: fixed-count static placeholders that never reorder
									<span className="tenx-icon-placeholder" key={`skeleton-${skeletonIndex}`} />
								))}
							</div>
						) : visible.length === 0 ? (
							<div className="tenx-icon-drawer__empty">{t(keys.noIconsFound)}</div>
						) : (
							<div
								role="presentation"
								style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
							>
								{virtualizer.getVirtualItems().map((row) => (
									<div
										className="tenx-icon-drawer__row"
										data-index={row.index}
										key={row.key}
										role="presentation"
										style={{
											left: 0,
											position: 'absolute',
											top: 0,
											transform: `translateY(${row.start}px)`,
											width: '100%',
										}}
									>
										{visible
											.slice(row.index * columns, row.index * columns + columns)
											.map((icon, columnIndex) => {
												const cellIndex = row.index * columns + columnIndex
												return (
													<IconGridCell
														canvas={entry?.canvas}
														entry={entry}
														focused={cellIndex === focusIndex}
														icon={icon}
														index={cellIndex}
														isSelected={
															selected?.library === activeLibrary && selected.name === icon.name
														}
														key={icon.name}
														language={i18n.language}
														nodes={NodesLoader ? nodeMap?.[icon.name] : undefined}
														onSelect={handleSelect}
														registerRef={registerRef}
													/>
												)
											})}
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
			<div className="tenx-icon-drawer__footer">
				{t(keys.resultsCount, { count: visible.length })}
			</div>
		</div>
	)
}

export default IconDrawerContent
