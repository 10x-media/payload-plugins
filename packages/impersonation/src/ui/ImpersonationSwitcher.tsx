'use client'

import {
	Button,
	Drawer,
	Pagination,
	RenderCustomComponent,
	SearchFilter,
	SearchIcon,
	SelectInput,
	toast,
	useConfig,
	useDocumentDrawer,
	useModal,
} from '@payloadcms/ui'
import type { CollectionSlug, Where } from 'payload'
import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react'

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
	apiPath?: string
	collections: SwitcherCollection[]
	reasonMode?: 'off' | 'optional' | 'required'
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
	const { apiPath, cardEmail, reasonMode, targets } = useImpersonation()
	const [collection, setCollection] = useState(collections[0]?.slug ?? '')
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
		() => collections.filter((entry) => targets[entry.slug] !== undefined),
		[collections, targets]
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

	const load = useCallback(async () => {
		if (!collection || !isModalOpen(drawerSlug)) {
			return
		}
		setLoading(true)
		try {
			const filter = targets[collection]
			const clauses: Where[] = []
			if (filter && filter !== true) {
				clauses.push(filter)
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
		} catch {
			toast.error(t(keys.errorFailed))
			setDocs([])
			setHasNext(false)
			setHasPrev(false)
			setTotalPages(1)
		} finally {
			setLoading(false)
		}
	}, [collection, config.routes.api, isModalOpen, page, search, t, targets, useAsTitle])

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
				buttonStyle="none"
				margin={false}
				onClick={() => {
					setPage(1)
					openModal(drawerSlug)
				}}
			>
				<span className="impersonation-header-action" data-testid="impersonation-switcher">
					<ImpersonateIcon />
					{t(keys.switchToUser)}
				</span>
			</Button>
			<Drawer slug={drawerSlug} title={t(keys.switchToUser)}>
				<div className="impersonation-switcher">
					<div className="search-bar impersonation-toolbar">
						<SearchIcon />
						<SearchFilter handleChange={onSearch} label={t(keys.searchByName)} />
						{visibleCollections.length > 1 ? (
							<div className="search-bar__actions impersonation-collection">
								<SelectInput
									isClearable={false}
									name="impersonation-collection"
									onChange={(incoming) => {
										const next = Array.isArray(incoming) ? incoming[0] : incoming
										const value =
											next && typeof next === 'object' && 'value' in next
												? String(next.value)
												: String(next ?? '')
										setCollection(value)
										setPage(1)
									}}
									options={visibleCollections.map((entry) => ({
										label: entry.label,
										value: entry.slug,
									}))}
									path="impersonation-collection"
									value={collection}
								/>
							</div>
						) : null}
					</div>
					<div className="impersonation-switcher__results">
						{docs.length === 0 && !loading ? (
							<p className="impersonation-switcher__empty">{t(keys.noResults)}</p>
						) : null}
						{docs.map((doc) => {
							if (String(doc.id) === String(viewerId) && collection === config.admin.user) {
								return null
							}
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
								onChange={setPage}
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
