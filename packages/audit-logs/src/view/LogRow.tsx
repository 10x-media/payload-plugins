'use client'

import { ChevronIcon, ExternalLinkIcon, Link } from '@payloadcms/ui'

import { useSearchParams } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { DiffViewer } from './DiffViewer'
import { FormattedDate } from './FormattedDate'
import type { AuditLogDoc } from './types'
import { UserPill } from './UserPill'
import { apiBadgeClass, apiLabel, GLOBAL_SENTINEL, OPERATION_LABELS, resolveUser } from './utils'
import { ValueTable } from './ValueTable'

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined

type Props = {
	adminRoute: string
	/** Collection and global labels from their config, keyed by slug. */
	collectionLabels: Record<string, string>
	doc: AuditLogDoc
	/** Label per auth or custom event type, for the badge. */
	eventTypeLabels: Record<string, string>
	globalLabels: Record<string, string>
	payloadAPILabels: Record<string, string>
	/** Host renderer for a custom event, replacing the default table and JSON. */
	renderedEvent?: ReactNode
	/** Tenant names by id, in the all-tenants view only; the tenant view leaves it out. */
	tenantLabels?: Record<string, string>
	userTitleFields: Record<string, string>
}

export function LogRow({
	adminRoute,
	collectionLabels,
	doc,
	eventTypeLabels,
	globalLabels,
	payloadAPILabels,
	renderedEvent,
	tenantLabels,
	userTitleFields,
}: Props) {
	const { t } = useTranslation()
	const [expanded, setExpanded] = useState(false)
	const searchParams = useSearchParams()
	// "Filter by this": the current query plus one value, back on the first page.
	const filterHref = (key: string, value: string, mode: 'add' | 'set'): string => {
		const params = new URLSearchParams(searchParams?.toString() ?? '')
		if (mode === 'set') params.set(key, value)
		else if (!params.getAll(key).includes(value)) params.append(key, value)
		params.delete('page')
		return `?${params.toString()}`
	}
	const groupHref = doc.group ? filterHref('group', doc.group, 'set') : undefined
	const isGlobal = doc.relationTo === GLOBAL_SENTINEL
	// A login has no document and a delete removes every locale, so the request's
	// locale says nothing there. Entries written before it was dropped still carry it.
	const locale = doc.operation === 'auth' || doc.operation === 'delete' ? undefined : doc.locale

	const tenantId =
		doc.tenant && typeof doc.tenant === 'object'
			? (doc.tenant as { id?: unknown }).id
			: (doc.tenant as number | string | undefined)
	const tenantHref =
		tenantId != null && tenantLabels ? filterHref('tenant', String(tenantId), 'set') : undefined

	const pathCount = doc.changedPaths?.length ?? 0
	const diff = doc.diff && Object.keys(doc.diff).length > 0 ? doc.diff : undefined
	const hasDiff = diff !== undefined
	const snapshot = asRecord(doc.snapshot)
	const metadata = asRecord(doc.metadata)
	const hasSnapshot = Boolean(snapshot)
	const hasMetadata = Boolean(metadata && Object.keys(metadata).length > 0)
	const hasEventDetails = hasMetadata || Boolean(renderedEvent)
	const hasMeta = Boolean(doc.ipAddress || doc.userAgent)
	const hasGroup = Boolean(doc.group)
	const user = resolveUser(doc.user, userTitleFields)
	const impersonator = resolveUser(doc.impersonator, userTitleFields)
	// A delete leaves nothing to open, so its collection name stays plain text.
	const docHref =
		doc.operation === 'delete'
			? undefined
			: isGlobal
				? `${adminRoute}/globals/${doc.documentId}`
				: doc.documentId
					? `${adminRoute}/collections/${doc.relationTo}/${encodeURIComponent(doc.documentId)}`
					: undefined
	const isExpandable = hasDiff || hasSnapshot || hasEventDetails || hasMeta || hasGroup || locale
	const entityName = isGlobal
		? (globalLabels[doc.documentId ?? ''] ?? doc.documentId)
		: (collectionLabels[doc.relationTo] ?? doc.relationTo)
	const entitySlug = isGlobal ? doc.documentId : doc.relationTo

	return (
		<div className={`al-row${expanded ? ' al-row--expanded' : ''}`}>
			{/* A div, not a button: the user pill holds a link and a popup trigger, which a
			    button may not contain. The toggle is stretched over the row underneath them. */}
			<div className={`al-row__summary${isExpandable ? ' al-row__summary--expandable' : ''}`}>
				{isExpandable && (
					<button
						type="button"
						className="al-row__hit"
						aria-expanded={expanded}
						aria-label={t(keys.toggleDetails)}
						onClick={() => setExpanded((v) => !v)}
					/>
				)}
				<span
					aria-hidden
					className={`al-row__toggle${!isExpandable ? ' al-row__toggle--hidden' : ''}`}
				>
					<ChevronIcon direction={expanded ? 'down' : 'right'} className="al-row__toggle-icon" />
				</span>

				<span className="al-row__op-col">
					<span className={`al-badge al-badge--op al-badge--${doc.operation}`}>
						{doc.eventType
							? (eventTypeLabels[doc.eventType] ?? doc.eventType)
							: (OPERATION_LABELS[doc.operation] ?? doc.operation)}
					</span>
					{docHref ? (
						<Link
							className="al-row__collection al-row__collection--link"
							href={docHref}
							rel="noopener"
							target="_blank"
							title={`${isGlobal ? t(keys.viewGlobal) : t(keys.viewDocument)}: ${entitySlug}`}
						>
							<span className="al-row__collection-name">{entityName}</span>
							<ExternalLinkIcon />
						</Link>
					) : (
						<span className="al-row__collection" title={entitySlug}>
							{entityName}
						</span>
					)}
				</span>

				<span className="al-row__user">
					{user ? (
						<UserPill adminRoute={adminRoute} impersonator={impersonator} user={user} />
					) : (
						<span className="al-row__empty">—</span>
					)}
				</span>

				<span className="al-row__badges">
					{doc.payloadAPI && (
						<span className={`al-badge al-badge--api ${apiBadgeClass(doc.payloadAPI)}`}>
							{apiLabel(doc.payloadAPI, payloadAPILabels)}
						</span>
					)}
					{locale && <span className="al-badge al-badge--locale">{locale}</span>}
					{tenantHref && tenantId != null && (
						<a
							className="al-badge al-badge--tenant"
							href={tenantHref}
							title={`${t(keys.filterTenant)}: ${tenantLabels?.[String(tenantId)] ?? String(tenantId)}`}
						>
							{/* The badge is a flex box, which ellipsis does not apply to; the text is. */}
							<span className="al-badge__text">
								{tenantLabels?.[String(tenantId)] ?? String(tenantId)}
							</span>
						</a>
					)}
				</span>

				<span className="al-row__right">
					{pathCount > 0 && (
						<span className="al-row__paths-count">
							{t(pathCount !== 1 ? keys.fieldsChangedPlural : keys.fieldsChanged, {
								count: pathCount,
							})}
						</span>
					)}
					<FormattedDate iso={doc.createdAt} />
				</span>
			</div>

			<div className="al-row__body">
				<div className="al-row__detail">
					<div className="al-row__detail-inner">
						{(doc.ipAddress || doc.userAgent || locale || groupHref) && (
							<div className="al-row__meta">
								{doc.ipAddress && (
									<span className="al-row__meta-item">
										<span className="al-row__meta-label">{t(keys.metaIp)}</span>
										<span>{doc.ipAddress}</span>
									</span>
								)}
								{doc.userAgent && (
									<span className="al-row__meta-item" title={doc.userAgent}>
										<span className="al-row__meta-label">{t(keys.metaUa)}</span>
										<span className="al-row__ua">{doc.userAgent}</span>
									</span>
								)}
								{locale && (
									<span className="al-row__meta-item">
										<span className="al-row__meta-label">{t(keys.metaLocale)}</span>
										<span>{locale}</span>
									</span>
								)}
								{doc.group && groupHref && (
									<span className="al-row__meta-item">
										<span className="al-row__meta-label">{t(keys.filterGroup)}</span>
										<a className="al-row__meta-link" href={groupHref}>
											{doc.group}
										</a>
									</span>
								)}
							</div>
						)}

						{/* A list reads faster than the table's first column; each path also
						    narrows the view to entries that changed it. */}
						{doc.changedPaths && doc.changedPaths.length > 0 && (
							<div className="al-row__changed-paths">
								{doc.changedPaths.map((p) => (
									<a
										className="al-path-tag"
										href={filterHref('changedPath', p, 'add')}
										key={p}
										title={t(keys.filterChangedPath)}
									>
										{p}
									</a>
								))}
							</div>
						)}

						{diff && <DiffViewer diff={diff} />}

						{snapshot && (
							<div className="al-row__section">
								<div className="al-row__section-label">{t(keys.sectionSnapshot)}</div>
								<ValueTable value={snapshot} />
							</div>
						)}

						{/* Event type, collection and document are already on the row; what is
						    left is the event's own data. */}
						{hasEventDetails && (
							<div className="al-row__section">
								<div className="al-row__section-label">
									{doc.operation === 'auth' ? t(keys.sectionAuthEvent) : t(keys.sectionCustomEvent)}
								</div>
								{renderedEvent ?? (metadata && <ValueTable value={metadata} />)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
