'use client'

import {
	BulkUploadProvider,
	ChevronIcon,
	EditDepthProvider,
	EntityVisibilityProvider,
	Modal,
	Pill,
	useAuth,
	useConfig,
	useModal,
	useTranslation as usePayloadTranslation,
	XIcon,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import type { ListQuery } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ClientOverlay, ManifestItem, SettingsOverlayEmbed } from '../types'
import {
	SettingsOverlayEmbedContext,
	SettingsPanelContext,
	type SettingsPanelState,
	SettingsRailContext,
	useSettingsOverlay,
} from './context'
import { DocumentPane } from './panes/DocumentPane'
import { LazyPane } from './panes/LazyPane'
import { ListPane } from './panes/ListPane'
import { SettingsRail } from './Rail'
import type { OverlaySlots } from './slots'
import './styles.css'

const base = 'settings-overlay'

/** Payload's drawers start at z 100 plus depth, so the panel sits one below the first drawer. */
const PANEL_Z_INDEX = 100

/**
 * Payload's page template mounts `EntityVisibilityProvider` and `BulkUploadProvider` around every
 * page, and custom providers such as this plugin's sit outside it. The edit view in page mode
 * renders `SetDocumentStepNav`, which calls `isEntityVisible` from a context whose default is an
 * empty object, so without this provider every document pane throws "is not a function". Nothing
 * in the panel may link out to a list route, so no entity is reported visible and the step nav
 * renders plain text.
 */
const NO_VISIBLE_ENTITIES = { collections: [], globals: [] }

/**
 * One floating panel per configured overlay, mounted once by the provider and rendering nothing
 * until its overlay is open.
 *
 * The rail arrives with the page, so there is no loading state for it. The panes fetch their own
 * content, except a `component` item that was rendered ahead of time.
 */
export const SettingsPanel: React.FC<{ overlay: ClientOverlay; slots?: OverlaySlots }> = ({
	overlay,
	slots,
}) => {
	const settings = useSettingsOverlay()
	const { closeModal, modalState, openModal } = useModal()
	const router = useRouter()
	const { config } = useConfig()
	const { t } = useTranslation()
	const [search, setSearch] = useState('')
	const panelRef = useRef<HTMLDivElement>(null)

	// The panel animates in from a class rather than from mount, so the browser gets a frame with
	// the closed values to transition away from.
	const [animateIn, setAnimateIn] = useState(false)

	const slug = settings.panelSlug(overlay.id)
	const titleId = `${slug}__title`
	const isOpen = settings.isOpen(overlay.id)
	const facelessOpen = Boolean(modalState[slug]?.isOpen)
	const manifest = settings.manifests[overlay.id]
	const wasOpen = useRef(false)

	// This plugin's state is the source of truth; faceless-ui follows it.
	useEffect(() => {
		if (isOpen && !facelessOpen) {
			openModal(slug)
		}
		if (!isOpen && facelessOpen) {
			closeModal(slug)
		}
	}, [closeModal, facelessOpen, isOpen, openModal, slug])

	useLayoutEffect(() => {
		setAnimateIn(isOpen)
		if (!isOpen) {
			setSearch('')
		}
	}, [isOpen])

	const items = useMemo(() => manifest?.groups.flatMap((group) => group.items) ?? [], [manifest])

	const activeItem: ManifestItem | undefined = useMemo(() => {
		if (!items.length) {
			return undefined
		}
		const wanted = settings.target.item
		return (
			items.find((item) => item.slug === wanted && item.type !== 'link') ??
			items.find((item) => item.type !== 'link')
		)
	}, [items, settings.target.item])

	// A panel opened without an item resolves to the rail's first entry. Write that back as the
	// real target so the URL names it and the form-modified reporter can recognise its own
	// document. Replaces rather than pushes, so back still closes the panel in one step.
	const { setTarget } = settings
	const targetItem = settings.target.item
	const activeSlug = activeItem?.slug
	useEffect(() => {
		if (!isOpen || targetItem !== undefined || !activeSlug) {
			return
		}
		setTarget({ item: activeSlug })
	}, [activeSlug, isOpen, setTarget, targetItem])

	const select = useCallback(
		(item: ManifestItem) => {
			if (item.type === 'link' && item.href) {
				settings.guard(() => {
					settings.close()
					router.push(
						formatAdminURL({ adminRoute: config.routes.admin, path: item.href as `/${string}` })
					)
				})
				return
			}
			if (item.slug === activeItem?.slug && !settings.target.id) {
				return
			}
			settings.guard(() => {
				settings.setTarget({
					item: item.slug,
					...(item.directDocID ? { id: item.directDocID } : {}),
				})
			})
		},
		[activeItem?.slug, config.routes.admin, router, settings]
	)

	const requestClose = useCallback(() => {
		settings.guard(() => {
			settings.close()
		})
	}, [settings])

	// Escape (faceless-ui closes the latest modal) must not lose unsaved edits silently: reopen
	// and ask.
	useEffect(() => {
		if (wasOpen.current && !facelessOpen && isOpen) {
			if (settings.formModified) {
				openModal(slug)
				settings.guard(() => {
					settings.close()
				})
			} else {
				settings.close()
			}
		}
		wasOpen.current = facelessOpen
	}, [facelessOpen, isOpen, openModal, settings, slug])

	// A row that resolves its own document has no list to go back to.
	const canGoBack =
		activeItem?.type === 'collection' && Boolean(settings.target.id) && !activeItem.directDocID

	const goBack = useCallback(() => {
		if (!activeItem) {
			return
		}
		// Switching the target unmounts the document pane and mounts a fresh list pane, which
		// fetches on mount; nothing else needs refreshing.
		settings.guard(() => {
			settings.setTarget({ item: activeItem.slug })
		})
	}, [activeItem, settings])

	/**
	 * Search narrows the rail only. The open pane stays open even once its row stops matching, so
	 * typing never yanks the panel out from under somebody mid-read.
	 *
	 * Computed here rather than in the rail so a replaced `Rail` or `RailGroup` reads the same
	 * narrowed list the default one does.
	 */
	const visibleGroups = useMemo(() => {
		const needle = search.trim().toLowerCase()
		const groups = manifest?.groups ?? []
		if (!needle) {
			return groups
		}
		return groups
			.map((group) => ({
				...group,
				items: group.items.filter((item) =>
					[item.label, item.slug, ...(item.keywords ?? [])].some((term) =>
						term.toLowerCase().includes(needle)
					)
				),
			}))
			.filter((group) => group.items.length > 0)
	}, [manifest, search])

	const panelState = useMemo<SettingsPanelState>(
		() => ({
			activeItem,
			canGoBack,
			filtering: search.trim().length > 0,
			goBack,
			manifest: manifest ?? { groups: [], id: overlay.id, label: '' },
			overlay,
			requestClose,
			search,
			setSearch,
			visibleGroups,
		}),
		[activeItem, canGoBack, goBack, manifest, overlay, requestClose, search, visibleGroups]
	)

	const railValue = useMemo(
		() => ({
			activeSlug: activeItem?.slug,
			icons: Object.fromEntries(
				items.map((item) => [item.slug, settings.icons[`${overlay.id}/${item.slug}`]])
			),
			itemSlots: slots?.RailItem ?? {},
			items,
			select,
		}),
		[activeItem?.slug, items, overlay.id, select, settings.icons, slots?.RailItem]
	)

	const embed = useMemo<SettingsOverlayEmbed | null>(
		() =>
			activeItem
				? {
						close: settings.close,
						itemSlug: activeItem.slug,
						itemType: activeItem.type,
						layout: overlay.layout,
						overlayId: overlay.id,
						setTarget: settings.setTarget,
						...(activeItem.directDocID ? { directDocID: activeItem.directDocID } : {}),
						...(settings.target.id ? { docID: settings.target.id } : {}),
					}
				: null,
		[activeItem, overlay.id, overlay.layout, settings.close, settings.setTarget, settings.target.id]
	)

	if (!isOpen || !manifest) {
		return null
	}

	return (
		<Modal
			aria-labelledby={titleId}
			className={[
				base,
				`${base}--${overlay.id}`,
				`${base}--${overlay.layout}`,
				overlay.mergeListHeader && `${base}--merged-list-header`,
				animateIn && `${base}--is-open`,
				overlay.className,
			]
				.filter(Boolean)
				.join(' ')}
			closeOnBlur={false}
			// Land on the panel, not on the first tabbable thing inside it. Left to itself the trap
			// opens the panel with a control focused and its caret blinking, which reads as an
			// instruction to type. Focus still enters the dialog, so Escape and tab-trapping work.
			focusTrapOptions={{ initialFocus: () => panelRef.current }}
			slug={slug}
			style={{ zIndex: PANEL_Z_INDEX }}
		>
			<button
				aria-label={t(keys.close)}
				className={`${base}__backdrop`}
				onClick={requestClose}
				type="button"
			/>
			<div className={`${base}__panel`} ref={panelRef} role="document" tabIndex={-1}>
				<EntityVisibilityProvider visibleEntities={NO_VISIBLE_ENTITIES}>
					<BulkUploadProvider drawerSlugPrefix={slug}>
						<EditDepthProvider>
							<SettingsPanelContext value={panelState}>
								<SettingsOverlayEmbedContext value={embed}>
									{slots?.Panel ?? (
										<>
											<SettingsRailContext value={railValue}>
												<SettingsRail overlayIcon={settings.icons[overlay.id]} slots={slots} />
											</SettingsRailContext>
											<section className={`${base}__pane`}>
												{slots?.Header ?? (
													<header className={`${base}__pane-header`}>
														{canGoBack ? (
															<button
																aria-label={t(keys.back)}
																className={`${base}__icon-button`}
																onClick={goBack}
																type="button"
															>
																<ChevronIcon className={`${base}__back-icon`} />
															</button>
														) : null}
														<h3 className={`${base}__pane-title`} id={titleId}>
															{activeItem?.label ?? manifest.label}
														</h3>
														{overlay.mergeListHeader &&
														activeItem?.type === 'collection' &&
														!settings.target.id &&
														!activeItem.directDocID ? (
															<CreateNewButton
																collectionSlug={activeItem.slug}
																onCreate={() => {
																	settings.setTarget({ id: 'new', item: activeItem.slug })
																}}
															/>
														) : null}
														<button
															aria-label={t(keys.close)}
															className={`${base}__icon-button`}
															onClick={requestClose}
															type="button"
														>
															<XIcon />
														</button>
													</header>
												)}
												<div className={`${base}__pane-body`}>
													<Pane
														activeItem={activeItem}
														overlay={overlay}
														panelSlug={slug}
														slots={slots}
													/>
												</div>
											</section>
										</>
									)}
								</SettingsOverlayEmbedContext>
							</SettingsPanelContext>
						</EditDepthProvider>
					</BulkUploadProvider>
				</EntityVisibilityProvider>
			</div>
		</Modal>
	)
}

/**
 * The list's own Create button, lifted into the pane header when `mergeListHeader` is on.
 *
 * Payload's markup and translation rather than a lookalike: the same `Pill` at the same size
 * under the same `list-header__create-new-button` class, labelled with its own
 * `general:createNew`, so a host styling that class styles this too and the label is translated
 * everywhere Payload is. Only the toggler differs, because the pane switches to the create form
 * in place instead of opening a nested drawer.
 */
const CreateNewButton: React.FC<{ collectionSlug: string; onCreate: () => void }> = ({
	collectionSlug,
	onCreate,
}) => {
	const { permissions } = useAuth()
	const { t } = usePayloadTranslation()

	if (permissions?.collections?.[collectionSlug]?.create !== true) {
		return null
	}

	return (
		<button
			className={`list-header__create-new-button doc-drawer__toggler ${base}__create`}
			onClick={onCreate}
			type="button"
		>
			<Pill size="small">{t('general:createNew')}</Pill>
		</button>
	)
}

/** What the pane shows for the active row. Keyed by the panel so a switch remounts cleanly. */
const Pane: React.FC<{
	activeItem: ManifestItem | undefined
	overlay: ClientOverlay
	panelSlug: string
	slots?: OverlaySlots
}> = ({ activeItem, overlay, panelSlug, slots }) => {
	const settings = useSettingsOverlay()
	const { t } = useTranslation()

	if (!activeItem) {
		return slots?.Empty ?? <p className={`${base}__empty`}>{t(keys.empty)}</p>
	}

	const key = `${overlay.id}/${activeItem.slug}`

	if (activeItem.type === 'view') {
		return <LazyPane itemSlug={activeItem.slug} overlayId={overlay.id} />
	}

	if (activeItem.type === 'component') {
		const eager = settings.rendered[key]
		return eager ?? <LazyPane itemSlug={activeItem.slug} overlayId={overlay.id} />
	}

	if (activeItem.type === 'global') {
		return (
			<DocumentPane
				entity="global"
				key={`global-${activeItem.slug}`}
				panelSlug={panelSlug}
				slug={activeItem.slug}
			/>
		)
	}

	if (settings.target.id) {
		return (
			<DocumentPane
				entity="collection"
				id={settings.target.id}
				key={`doc-${activeItem.slug}-${settings.target.id}`}
				onBack={() => {
					settings.setTarget({ item: activeItem.slug })
				}}
				onCreated={(id) => {
					settings.setTarget({ id, item: activeItem.slug })
				}}
				panelSlug={panelSlug}
				slug={activeItem.slug}
			/>
		)
	}

	return (
		<ListPane
			collectionSlug={activeItem.slug}
			key={`list-${activeItem.slug}`}
			onCreate={() => {
				settings.setTarget({ id: 'new', item: activeItem.slug })
			}}
			onQueryChange={settings.setListQuery}
			onSelectDocument={(id) => {
				settings.setTarget({ id, item: activeItem.slug })
			}}
			panelSlug={panelSlug}
			query={settings.target.query as ListQuery | undefined}
		/>
	)
}
