'use client'

import type { ListQuery } from 'payload'
import { createContext, use } from 'react'

import type {
	ClientOverlay,
	Manifest,
	ManifestGroup,
	ManifestItem,
	SettingsOverlayEmbed,
	Target,
} from '../types'

export type SettingsOverlayContextValue = {
	activeOverlayId: null | string
	close: () => void
	/** Slug of the shared discard-changes confirmation modal. */
	discardSlug: string
	formModified: boolean
	/** Runs `action` now, or after the reader confirms discarding unsaved edits. */
	guard: (action: () => void) => void
	/** Server-rendered icon nodes, keyed by `overlayId` and `overlayId/itemSlug`. */
	icons: Record<string, React.ReactNode>
	isOpen: (overlayId: string) => boolean
	/** Which channel a lazy item is fetched through. See the plugin's `lazyTransport` option. */
	lazyTransport: 'server-function' | 'widget'
	manifests: Record<string, Manifest>
	open: (overlayId: string, target?: Target) => void
	overlays: ClientOverlay[]
	panelSlug: (overlayId: string) => string
	/** Server-rendered eager `component` items, keyed by `overlayId/itemSlug`. */
	rendered: Record<string, React.ReactNode>
	setFormModified: (modified: boolean) => void
	/** Replaces the list query of the current target; `undefined` clears it. */
	setListQuery: (query: ListQuery | undefined) => void
	setTarget: (target: Target) => void
	target: Target
	toggle: (overlayId: string, target?: Target) => void
}

export const SettingsOverlayContext = createContext<null | SettingsOverlayContextValue>(null)

/** `null` when the plugin's provider is not mounted, which is how the reporter stays harmless. */
export const useSettingsOverlayOptional = (): null | SettingsOverlayContextValue =>
	use(SettingsOverlayContext)

/** Control of the panels: open, close, and where they point. Available anywhere in the admin. */
export const useSettingsOverlay = (): SettingsOverlayContextValue => {
	const value = use(SettingsOverlayContext)
	if (!value) {
		throw new Error('useSettingsOverlay must be used inside the settings overlay provider')
	}
	return value
}

/**
 * Where the reading component is, mounted by the panel rather than by the provider.
 *
 * The provider wraps the whole admin, so a context on it would report "inside a panel"
 * everywhere while one was open. This one is mounted by the pane, so it is `null` exactly
 * when the caller is not in a panel.
 */
export const SettingsOverlayEmbedContext = createContext<null | SettingsOverlayEmbed>(null)

export const useSettingsOverlayEmbed = (): null | SettingsOverlayEmbed =>
	use(SettingsOverlayEmbedContext)

export type SettingsPanelState = {
	/** The row currently shown in the pane, or `undefined` when the rail is empty. */
	activeItem: ManifestItem | undefined
	/** True when the pane shows a document reached from a list, so "back" means something. */
	canGoBack: boolean
	/** True while `search` holds a query, so the rail shows matches rather than everything. */
	filtering: boolean
	goBack: () => void
	manifest: Manifest
	overlay: ClientOverlay
	/** Closes the panel, asking first when the open document has unsaved edits. */
	requestClose: () => void
	search: string
	setSearch: (value: string) => void
	/**
	 * The manifest's groups narrowed by the current search, with emptied groups dropped. Read
	 * this rather than `manifest.groups` when rendering the rail, or a replacement will keep
	 * showing rows the reader has filtered out.
	 */
	visibleGroups: ManifestGroup[]
}

/** Panel-scope state for a replaced `Panel`, `Rail`, `Header` or `Search`. */
export const SettingsPanelContext = createContext<null | SettingsPanelState>(null)

export const useSettingsPanel = (): SettingsPanelState => {
	const value = use(SettingsPanelContext)
	if (!value) {
		throw new Error('useSettingsPanel must be used inside a settings overlay panel')
	}
	return value
}

export type SettingsItemState = {
	/** The icon this item was configured with, already rendered on the server. */
	icon: React.ReactNode
	isActive: boolean
	item: ManifestItem
	select: () => void
}

/** Per-row state for a replaced `RailItem`, so the replacement is not a fork. */
export const SettingsRailContext = createContext<null | {
	activeSlug: string | undefined
	/** Rendered icon nodes keyed by item slug. */
	icons: Record<string, React.ReactNode>
	/** `RailItem` replacements keyed by item slug, already rendered on the server. */
	itemSlots: Record<string, React.ReactNode>
	items: ManifestItem[]
	select: (item: ManifestItem) => void
}>(null)

/**
 * Everything a rail row needs to draw itself, including for a row the plugin is not drawing.
 * `null` when called outside a rail. Badge values come from `useSettingsBadge(slug)`.
 */
export const useSettingsItemState = (slug: string): SettingsItemState | null => {
	const rail = use(SettingsRailContext)
	const item = rail?.items.find((candidate) => candidate.slug === slug)
	if (!rail || !item) {
		return null
	}
	return {
		icon: rail.icons[slug] ?? null,
		isActive: rail.activeSlug === slug,
		item,
		select: () => {
			rail.select(item)
		},
	}
}
