'use client'

import {
	Button,
	ChevronIcon,
	Drawer,
	Pagination,
	Pill,
	Popup,
	PopupList,
	RenderCustomComponent,
	SearchFilter,
	SearchIcon,
	toast,
	useConfig,
	useDocumentDrawer,
	useModal,
} from '@payloadcms/ui'
import type { CollectionSlug, Where } from 'payload'
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SWITCHER_PAGE_SIZE } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ImpersonateIcon } from './ImpersonateIcon'
import { ImpersonationUserCard, type ImpersonationUserCardProps } from './ImpersonationUserCard'
import { StartConfirmModal, type StartTarget } from './StartConfirmModal'
import { useImpersonation } from './useImpersonation'
import './impersonation.css'

export type SwitcherCollection = {
	label: string
	slug: string
	useAsTitle: string
}

export type ImpersonationSwitcherProps = {
	Card?: ComponentType<ImpersonationUserCardProps>
	collections: SwitcherCollection[]
	viewerId: number | string
}

type ListedUser = Record<string, unknown> & { id: number | string }

const drawerSlug = 'impersonation-switcher'
const confirmSlug = 'impersonation-confirm-start'

const andWhere = (clauses: Where[]): Where => {
	const compact = clauses.filter((clause) => Object.keys(clause).length > 0)
	if (compact.length === 0) {
		return {}
	}
	if (compact.length === 1) {
		return compact[0] as Where
	}
	return { and: compact }
}

const PreviewDrawer = ({ collectionSlug, id }: { collectionSlug: string; id: number | string }) => {
	const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
		collectionSlug: collectionSlug as CollectionSlug,
		id: String(id),
	})

	useEffect(() => {
		openDrawer()
	}, [openDrawer])

	return <DocumentDrawer />
}

export const ImpersonationSwitcher = ({
	Card,
	collections,
	viewerId,
}: ImpersonationSwitcherProps) => {
	const { config } = useConfig()
	const { t } = useTranslation()
	const { closeModal, isModalOpen, openModal } = useModal()
	const { apiPath, cardEmail, reasonMode, targetFilters } = useImpersonation()
	const [collection, setCollection] = useState(collections[0]?.slug ?? '')
	const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const [docs, setDocs] = useState<ListedUser[]>([])
	const [hasNext, setHasNext] = useState(false)
	const [hasPrev, setHasPrev] = useState(false)
	const [totalPages, setTotalPages] = useState(1)
	const [loading, setLoading] = useState(false)
	const [target, setTarget] = useState<null | StartTarget>(null)
	const [preview, setPreview] = useState<null | { collection: string; id: number | string }>(null)

	const visibleCollections = useMemo(
		() => collections.filter((entry) => targetFilters[entry.slug] !== undefined),
		[collections, targetFilters]
	)

	useEffect(() => {
		if (visibleCollections.some((entry) => entry.slug === collection)) {
			return
		}
		setCollection(visibleCollections[0]?.slug ?? '')
	}, [collection, visibleCollections])

	const collectionMeta = visibleCollections.find((entry) => entry.slug === collection)
	const useAsTitle = collectionMeta?.useAsTitle ?? 'email'

	const onSearch = useCallback((value: string) => {
		setPage(1)
		setSearch(value ?? '')
	}, [])

	const listAbort = useRef<AbortController | null>(null)
	const switcherRef = useRef<HTMLDivElement>(null)
	const resultsRef = useRef<HTMLDivElement>(null)

	const changePage = (next: number) => {
		setPage(next)
		switcherRef.current?.closest('.drawer__content-children')?.scrollTo({ top: 0 })
		resultsRef.current?.scrollTo({ top: 0 })
	}

	const load = useCallback(async () => {
		if (!collection || !isModalOpen(drawerSlug)) {
			return
		}
		listAbort.current?.abort()
		const controller = new AbortController()
		listAbort.current = controller
		setLoading(true)
		try {
			const filter = targetFilters[collection]
			const clauses: Where[] = []
			if (filter && filter !== true) {
				clauses.push(filter)
			}
			if (collection === config.admin.user && viewerId !== undefined && viewerId !== '') {
				clauses.push({ id: { not_equals: viewerId } })
			}
			const trimmed = search.trim()
			if (trimmed) {
				const fields = new Set(['email', useAsTitle])
				clauses.push({
					or: [...fields].map((field) => ({ [field]: { like: trimmed } })),
				})
			}
			const params = new URLSearchParams({
				depth: '0',
				limit: String(SWITCHER_PAGE_SIZE),
				page: String(page),
				sort: useAsTitle,
				where: JSON.stringify(andWhere(clauses)),
			})
			const response = await fetch(`${config.routes.api}/${collection}?${params.toString()}`, {
				credentials: 'include',
				signal: controller.signal,
			})
			if (!response.ok) {
				throw new Error(String(response.status))
			}
			const body = (await response.json()) as {
				docs?: ListedUser[]
				hasNextPage?: boolean
				hasPrevPage?: boolean
				totalPages?: number
			}
			setDocs(body.docs ?? [])
			setHasNext(Boolean(body.hasNextPage))
			setHasPrev(Boolean(body.hasPrevPage))
			setTotalPages(body.totalPages ?? 1)
		} catch (error) {
			if (
				controller.signal.aborted ||
				(error instanceof DOMException && error.name === 'AbortError')
			) {
				return
			}
			toast.error(t(keys.errorFailed))
			setDocs([])
			setHasNext(false)
			setHasPrev(false)
			setTotalPages(1)
		} finally {
			if (!controller.signal.aborted) {
				setLoading(false)
			}
		}
	}, [
		collection,
		config.admin.user,
		config.routes.api,
		isModalOpen,
		page,
		search,
		t,
		targetFilters,
		useAsTitle,
		viewerId,
	])

	useEffect(() => {
		void load()
	}, [load])

	const pick = (doc: ListedUser) => {
		const title = String(doc[useAsTitle] ?? doc.email ?? doc.id)
		setTarget({ collection, id: doc.id, label: title })
		closeModal(drawerSlug)
		openModal(confirmSlug)
	}

	if (visibleCollections.length === 0) {
		return null
	}

	return (
		<>
			<Button
				buttonStyle="subtle"
				className="impersonation-switcher-button"
				margin={false}
				onClick={() => {
					setPage(1)
					openModal(drawerSlug)
				}}
				size="small"
				icon={<ImpersonateIcon />}
				iconPosition="left"
			>
				{t(keys.switchToUser)}
			</Button>
			<Drawer slug={drawerSlug} title={t(keys.switchToUser)}>
				<div className="impersonation-switcher" ref={switcherRef}>
					<div className="search-bar">
						<SearchIcon />
						<SearchFilter handleChange={onSearch} label={t(keys.searchByName)} />
						{visibleCollections.length > 1 ? (
							<div className="search-bar__actions">
								<Popup
									button={
										<Pill
											className="impersonation-collection"
											icon={<ChevronIcon direction={collectionMenuOpen ? 'up' : 'down'} />}
											pillStyle="light"
											size="small"
										>
											{visibleCollections.find((entry) => entry.slug === collection)?.label ??
												collection}
										</Pill>
									}
									buttonType="custom"
									caret={false}
									horizontalAlign="right"
									onToggleOpen={setCollectionMenuOpen}
									render={({ close }) => (
										<PopupList.ButtonGroup>
											{visibleCollections.map((entry) => (
												<PopupList.Button
													active={entry.slug === collection}
													key={entry.slug}
													onClick={() => {
														setCollection(entry.slug)
														setPage(1)
														close()
													}}
												>
													{entry.label}
												</PopupList.Button>
											))}
										</PopupList.ButtonGroup>
									)}
									size="fit-content"
								/>
							</div>
						) : null}
					</div>
					<div className="impersonation-switcher__results" ref={resultsRef}>
						{docs.length === 0 && !loading ? (
							<p className="impersonation-switcher__empty">{t(keys.noResults)}</p>
						) : null}
						{docs.map((doc) => {
							const title = String(doc[useAsTitle] ?? doc.email ?? doc.id)
							const email = typeof doc.email === 'string' ? doc.email : undefined
							const showEmail = cardEmail && email && email !== title
							const cardProps: ImpersonationUserCardProps = {
								collectionSlug: collection,
								doc,
								documentHref: `${config.routes.admin}/collections/${collection}/${doc.id}`,
								email: showEmail ? email : undefined,
								onOpenDrawer: () => setPreview({ collection, id: doc.id }),
								onSelect: () => pick(doc),
								openDocumentLabel: t(keys.openDocument),
								openDrawerLabel: t(keys.openDrawer),
								title,
							}
							return (
								<RenderCustomComponent
									CustomComponent={Card ? <Card {...cardProps} /> : undefined}
									Fallback={<ImpersonationUserCard {...cardProps} />}
									key={String(doc.id)}
								/>
							)
						})}
					</div>
					{totalPages > 1 ? (
						<div className="impersonation-switcher__pager">
							<Pagination
								hasNextPage={hasNext}
								hasPrevPage={hasPrev}
								nextPage={page + 1}
								onChange={changePage}
								page={page}
								prevPage={Math.max(1, page - 1)}
								totalPages={totalPages}
							/>
						</div>
					) : null}
				</div>
			</Drawer>
			{preview ? (
				<PreviewDrawer
					collectionSlug={preview.collection}
					id={preview.id}
					key={`${preview.collection}:${preview.id}`}
				/>
			) : null}
			<StartConfirmModal
				apiPath={apiPath}
				key={target ? `${target.collection}:${target.id}` : 'idle'}
				modalSlug={confirmSlug}
				reasonMode={reasonMode}
				target={target}
			/>
		</>
	)
}
