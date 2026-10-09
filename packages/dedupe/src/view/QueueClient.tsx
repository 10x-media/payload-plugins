'use client'

import {
	Banner,
	Button,
	Link,
	Table,
	toast,
	useConfig,
	useTranslation as usePayloadTranslation,
	useStepNav,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { usePathname, useRouter } from 'next/navigation'
import type { Column } from 'payload'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'

import './index.css'

import { PAGE_SIZE, PAIR_STATUSES, type PairStatus } from '../collections/slugs'
import type { QueueGroup, QueueResponse } from '../queue/pairs'
import type { ScanSummary } from '../queue/scan'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { callApi, mergeUrl } from './api'
import { ChoicePill } from './ChoicePill'
import {
	column,
	ListHeader,
	ListPages,
	ListTabs,
	NoListResults,
	SearchBar,
	searchPlaceholder,
} from './native'
import { Signals } from './Signals'
import { SHORT_DATE } from './Value'

const baseClass = 'dedupe-queue'

const STATUS: Record<PairStatus, { label: TranslationKey; about: TranslationKey }> = {
	open: { label: keys.statusOpen, about: keys.aboutOpen },
	dismissed: { label: keys.statusDismissed, about: keys.aboutDismissed },
}

type QueueClientProps = {
	/** Empty for every collection. */
	collection: string
	data: QueueResponse
	limit: number
	/** The most documents the merge screen takes: a larger group opens with its most alike. */
	maxGroupSize: number
	mergePath: string
	/** An error the page arrived with, shown above the table as the list view shows one. */
	notice: null | string
	search: string
	status: PairStatus
}

/**
 * The groups of look-alike documents to review, laid out as a collection list: the first column
 * opens a group, as it opens a document there, and there are no buttons in the rows. Marking a
 * group not duplicates happens on the merge screen, where its documents are in view.
 */
export function QueueClient({
	collection,
	data,
	limit,
	maxGroupSize,
	mergePath,
	notice,
	search,
	status,
}: QueueClientProps) {
	const { i18n, t } = useTranslation()
	const { i18n: payloadI18n, t: payloadT } = usePayloadTranslation()
	const {
		config: {
			routes: { api: apiRoute },
		},
		getEntityConfig,
	} = useConfig()
	const router = useRouter()
	const pathname = usePathname()
	const { setStepNav } = useStepNav()
	const [busy, setBusy] = useState(false)
	const [navigating, startTransition] = useTransition()
	const { collections } = data

	// A collection filter is a level of its own, as the trash is under a collection's list: the
	// merge screen's crumbs lead back to it.
	const collectionLabel = collections.find((entry) => entry.slug === collection)?.label
	useEffect(() => {
		setStepNav(
			collectionLabel
				? [{ label: t(keys.queueTitle), url: pathname }, { label: collectionLabel }]
				: [{ label: t(keys.queueTitle) }]
		)
	}, [setStepNav, t, collectionLabel, pathname])

	/** The address carries the filters, and the server view reads the queue from it. */
	const navigate = useCallback(
		(next: {
			collection?: string
			limit?: number
			page?: number
			search?: string
			status?: PairStatus
		}) => {
			const target = { collection, status, limit, search, page: data.page, ...next }
			const query = new URLSearchParams({ status: target.status })
			if (target.collection) query.set('collection', target.collection)
			if (target.search) query.set('search', target.search)
			if (target.page > 1) query.set('page', String(target.page))
			if (target.limit !== PAGE_SIZE) query.set('limit', String(target.limit))
			startTransition(() => router.replace(`${pathname}?${query}`, { scroll: false }))
		},
		[collection, status, limit, search, data.page, pathname, router]
	)

	const scan = useCallback(async () => {
		setBusy(true)
		try {
			const result = await callApi<{ inline: boolean; summaries?: ScanSummary[] }>({
				apiRoute,
				path: '/dedupe/scan',
				method: 'POST',
				body: collection ? { collection } : {},
			})
			if (result.inline && result.summaries) {
				const total = (key: 'compared' | 'pairs') =>
					String(result.summaries?.reduce((sum, summary) => sum + summary[key], 0) ?? 0)
				toast.success(t(keys.scanDone, { pairs: total('pairs'), compared: total('compared') }))
			} else {
				toast.success(t(keys.scanQueued))
			}
			startTransition(() => router.refresh())
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t(keys.error))
		} finally {
			setBusy(false)
		}
	}, [apiRoute, collection, router, t])

	const placeholder = useMemo(
		() =>
			searchPlaceholder(
				(collection ? [collection] : collections.map((entry) => entry.slug)).flatMap((slug) => {
					const config = getEntityConfig({ collectionSlug: slug })
					return config ? [config] : []
				}),
				payloadI18n
			),
		[collection, collections, getEntityConfig, payloadI18n]
	)

	const canScan = collection
		? Boolean(collections.find((entry) => entry.slug === collection)?.hasMatch)
		: collections.some((entry) => entry.hasMatch)

	const columns = useMemo<Column[]>(() => {
		const rows = data.docs
		const labels = new Map(collections.map((entry) => [entry.slug, entry.label]))
		const titlesOf = (group: QueueGroup): string => {
			const named = group.docs
				.slice(0, 3)
				.map((doc) => doc.title)
				.join(', ')
			const more = group.docs.length - 3
			return more > 0 ? t(keys.andMore, { title: named, count: String(more) }) : named
		}
		return [
			column(
				'documents',
				payloadT('general:documents'),
				rows.map((group) => (
					<Link
						href={mergeUrl({
							mergePath,
							collection: group.collection,
							docs: group.docs.slice(0, maxGroupSize).map((doc) => doc.id),
						})}
						key={group.id}
					>
						{titlesOf(group)}
					</Link>
				))
			),
			column(
				'size',
				t(keys.groupSize),
				rows.map((group) => (
					<span key={group.id}>
						{group.docs.length > maxGroupSize
							? t(keys.perMerge, {
									count: String(group.docs.length),
									max: String(maxGroupSize),
								})
							: group.docs.length}
					</span>
				))
			),
			...(collection
				? []
				: [
						column(
							'collection',
							t(keys.collection),
							rows.map((group) => (
								<span key={group.id}>{labels.get(group.collection) ?? group.collection}</span>
							))
						),
					]),
			column(
				'score',
				t(keys.similarity),
				rows.map((group) => (
					<span className={`${baseClass}__score`} key={group.id}>
						{group.score > 0 ? `${Math.round(group.score * 100)}%` : '-'}
					</span>
				))
			),
			column(
				'signals',
				t(keys.signals),
				rows.map((group) => <Signals key={group.id} signals={group.signals} />)
			),
			...(status === 'dismissed'
				? [
						column(
							'decided',
							t(keys.markedBy),
							rows.map((group) => (
								<span key={group.id}>
									{[
										group.decidedBy,
										group.decidedAt
											? formatDate({ date: group.decidedAt, i18n, pattern: SHORT_DATE })
											: null,
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							))
						),
					]
				: []),
		]
	}, [data.docs, collection, collections, i18n, maxGroupSize, mergePath, payloadT, status, t])

	return (
		<div className={baseClass}>
			<ListHeader
				actions={
					<ListTabs
						onChange={(next) => navigate({ status: next, page: 1 })}
						tabs={PAIR_STATUSES.map((entry) => ({
							count: data.counts[entry],
							label: t(STATUS[entry].label),
							value: entry,
						}))}
						value={status}
					/>
				}
				description={t(STATUS[status].about)}
				title={t(keys.queueTitle)}
				titleActions={
					canScan ? (
						<Button
							buttonStyle="pill"
							disabled={busy || navigating}
							margin={false}
							onClick={() => void scan()}
							size="small"
						>
							{t(keys.runScan)}
						</Button>
					) : null
				}
			/>

			<div className="list-controls">
				<SearchBar
					actions={
						collections.length > 1 ? (
							<ChoicePill
								groupLabel={t(keys.collection)}
								onChange={(value) => navigate({ collection: value, page: 1 })}
								options={[
									{ label: payloadT('general:allCollections'), value: '' },
									...collections.map((entry) => ({ label: entry.label, value: entry.slug })),
								]}
								value={collection}
							/>
						) : null
					}
					label={placeholder}
					onSearchChange={(next) => navigate({ search: next ?? '', page: 1 })}
					search={search}
				/>
			</div>

			{notice ? <Banner type="error">{notice}</Banner> : null}

			{data.docs.length === 0 ? (
				<NoListResults>
					{search ? (
						<>
							<h3>{payloadT('general:noResultsFound')}</h3>
							<p className={`${baseClass}__message`}>{payloadT('general:noResultsDescription')}</p>
						</>
					) : (
						<p className={`${baseClass}__message`}>{t(keys.noPairs)}</p>
					)}
				</NoListResults>
			) : (
				<div className={`${baseClass}__table`}>
					<Table columns={columns} data={data.docs} />
				</div>
			)}

			{data.totalDocs > 0 ? (
				<ListPages
					limit={limit}
					onLimit={(next) => navigate({ limit: next, page: 1 })}
					onPage={(page) => navigate({ page })}
					page={data.page}
					totalDocs={data.totalDocs}
					totalPages={data.totalPages}
				/>
			) : null}
		</div>
	)
}
