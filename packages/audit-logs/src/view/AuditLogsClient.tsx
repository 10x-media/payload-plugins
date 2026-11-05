'use client'

import { Button, Gutter, PageControlsComponent, Pill, useRouter, useStepNav } from '@payloadcms/ui'
import { ListHeader } from '@payloadcms/ui/elements/ListHeader'
import type { PaginatedDocs } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'

import './index.css'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { FilterBar } from './filter-bar'
import { LogRow } from './LogRow'
import type { AuditLogDoc, AuditLogsClientProps } from './types'
import { buildParams } from './utils'

const LIMIT_OPTIONS = [10, 25, 50, 100]

export function AuditLogsClient({
	adminRoute,
	apiRoute,
	collectionOptions,
	docs,
	totalDocs,
	totalPages,
	page,
	limit,
	filters,
	globalOptions,
	tenantGlobalOptions,
	tenantsSlug,
	collectionLabels,
	globalLabels,
	refLabels,
	titleFields,
	lockedTenantId,
	tenantOptions,
	userTitleFields,
	payloadAPILabels,
	debugMode,
	renderedEvents,
	renderedRows,
	beforeList,
	afterList,
	customFilters,
	customEventTypes,
	hasArchive,
}: AuditLogsClientProps) {
	const router = useRouter()
	const [runningTask, setRunningTask] = useState<'audit-logs-archive' | 'audit-logs-delete' | null>(
		null
	)
	const [lastResult, setLastResult] = useState<string | null>(null)

	const { t } = useTranslation()

	const { setStepNav } = useStepNav()

	useEffect(() => {
		setStepNav([{ label: t(keys.breadcrumb) }])
	}, [setStepNav, t])

	const triggerJob = useCallback(
		async (task: 'audit-logs-archive' | 'audit-logs-delete') => {
			setRunningTask(task)
			setLastResult(null)
			try {
				const res = await fetch(
					`${formatAdminURL({ apiRoute, path: '/audit-retention/run' })}?task=${task}`,
					{ method: 'POST' }
				)
				const json = await res.json()
				if (res.ok) {
					setLastResult(`Queued: ${task}`)
				} else {
					setLastResult(`Error: ${json?.error ?? res.statusText}`)
				}
			} catch (err) {
				setLastResult(`Error: ${String(err)}`)
			} finally {
				setRunningTask(null)
			}
		},
		[apiRoute]
	)

	// Auth types are the plugin's own; custom ones come from `logs.eventTypes` and the
	// renderer keys. Used by the Event filter and the row badge alike.
	const eventTypeLabels = useMemo(
		() => ({
			login: t(keys.authEventLogin),
			failed_login: t(keys.authEventFailedLogin),
			forgot_password: t(keys.authEventForgotPassword),
			...Object.fromEntries(customEventTypes.map(({ label, value }) => [value, label])),
		}),
		[customEventTypes, t]
	)

	// Rows name their tenant in the all-tenants view only; the tenant view has one.
	const tenantLabels = useMemo(
		() =>
			lockedTenantId || !tenantOptions?.length
				? undefined
				: Object.fromEntries(tenantOptions.map(({ label, value }) => [value, label])),
		[lockedTenantId, tenantOptions]
	)

	const handleFilter = useCallback(
		(newFilters: typeof filters) => {
			router.push(`?${buildParams(newFilters, undefined, limit)}`)
		},
		[router, limit]
	)

	const goToPage = useCallback(
		(newPage: number) => {
			router.push(`?${buildParams(filters, newPage, limit)}`)
		},
		[router, filters, limit]
	)

	const handleLimit = useCallback(
		(newLimit: number) => {
			router.push(`?${buildParams(filters, 1, newLimit)}`)
		},
		[router, filters]
	)

	// Payload's own page controls, fed from the server's result rather than a list query.
	const pageData: PaginatedDocs = {
		docs,
		hasNextPage: page < totalPages,
		hasPrevPage: page > 1,
		limit,
		nextPage: page < totalPages ? page + 1 : null,
		page,
		pagingCounter: (page - 1) * limit + 1,
		prevPage: page > 1 ? page - 1 : null,
		totalDocs,
		totalPages,
	}

	// Development only: queue the retention jobs now instead of waiting for their cron.
	const debugActions = debugMode
		? [
				<Pill key="debug" pillStyle="warning">
					{t(keys.debug)}
				</Pill>,
				hasArchive ? (
					<Button
						buttonStyle="secondary"
						disabled={runningTask !== null}
						key="archive"
						margin={false}
						onClick={() => triggerJob('audit-logs-archive')}
						size="medium"
					>
						{runningTask === 'audit-logs-archive' ? t(keys.queuing) : t(keys.runArchive)}
					</Button>
				) : null,
				<Button
					buttonStyle="destructive"
					disabled={runningTask !== null}
					key="delete"
					margin={false}
					onClick={() => triggerJob('audit-logs-delete')}
					size="medium"
				>
					{runningTask === 'audit-logs-delete' ? t(keys.queuing) : t(keys.runDelete)}
				</Button>,
				lastResult ? (
					<span className="al-debug-result" key="result" role="status">
						{lastResult}
					</span>
				) : null,
			].filter(Boolean)
		: []

	return (
		<div className="al-view">
			<ListHeader
				Actions={debugActions}
				className="al-view__header"
				title={t(keys.title)}
				TitleActions={[
					<span className="al-view__count" key="count">
						{t(keys.entries, { count: totalDocs })}
					</span>,
				]}
			/>

			<FilterBar
				collectionOptions={collectionOptions}
				customEventTypes={customEventTypes}
				customFilters={customFilters}
				eventTypeLabels={eventTypeLabels}
				filters={filters}
				globalOptions={globalOptions}
				tenantGlobalOptions={tenantGlobalOptions}
				refLabels={refLabels}
				titleFields={titleFields}
				userCollections={Object.keys(userTitleFields)}
				onFilter={handleFilter}
				payloadAPILabels={payloadAPILabels}
				tenantOptions={lockedTenantId ? undefined : tenantOptions}
			/>

			<Gutter className="al-view__body">
				{beforeList}

				<div className="al-list">
					{docs.length === 0 ? (
						<div className="al-list__empty">{t(keys.noEntries)}</div>
					) : (
						docs.map((doc) => (
							<LogRow
								adminRoute={adminRoute}
								collectionLabels={collectionLabels}
								doc={doc as unknown as AuditLogDoc}
								globalLabels={globalLabels}
								key={String(doc.id)}
								eventTypeLabels={eventTypeLabels}
								payloadAPILabels={payloadAPILabels}
								renderedEvent={renderedEvents?.[String(doc.id)]}
								slots={renderedRows?.[String(doc.id)]}
								tenantLabels={tenantLabels}
								tenantsSlug={tenantsSlug}
								userTitleFields={userTitleFields}
							/>
						))
					)}
				</div>

				{afterList}
			</Gutter>

			{totalDocs > 0 && (
				<PageControlsComponent
					countLabel={t(keys.entries, { count: totalDocs })}
					data={pageData}
					handlePageChange={async (next) => goToPage(next)}
					handlePerPageChange={async (next) => handleLimit(next)}
					limit={limit}
					limits={LIMIT_OPTIONS}
				/>
			)}
		</div>
	)
}
