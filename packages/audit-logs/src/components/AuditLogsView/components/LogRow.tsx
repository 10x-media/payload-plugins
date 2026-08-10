'use client'

import { ChevronIcon, Link } from '@payloadcms/ui'

import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { AuditLogDoc } from '../types.js'
import { displayUser, GLOBAL_SENTINEL, OPERATION_LABELS } from '../utils.js'
import { DiffViewer } from './DiffViewer.js'
import { FormattedDate } from './FormattedDate.js'

type Props = {
	adminRoute: string
	doc: AuditLogDoc
	userTitleFields: Record<string, string>
}

export function LogRow({ adminRoute, doc, userTitleFields }: Props) {
	const { t } = useTranslation()
	const [expanded, setExpanded] = useState(false)
	const searchParams = useSearchParams()
	const groupHref = useMemo(() => {
		if (!doc.group) return undefined
		const params = new URLSearchParams(searchParams?.toString() ?? '')
		params.set('group', doc.group)
		params.delete('page')
		return `?${params.toString()}`
	}, [searchParams, doc.group])
	const isGlobal = doc.relationTo === GLOBAL_SENTINEL

	const pathCount = doc.changedPaths?.length ?? 0
	const diff = doc.diff && Object.keys(doc.diff).length > 0 ? doc.diff : undefined
	const hasDiff = diff !== undefined
	const hasSnapshot = Boolean(doc.snapshot)
	const hasMetadata = Boolean(doc.metadata)
	const isAuthOrCustom = doc.operation === 'auth' || doc.operation === 'custom'
	const hasMeta = Boolean(doc.ipAddress || doc.userAgent)
	const hasGroup = Boolean(doc.group)
	const isExpandable =
		hasDiff || hasSnapshot || hasMetadata || isAuthOrCustom || hasMeta || hasGroup

	return (
		<div className={`al-row${expanded ? ' al-row--expanded' : ''}`}>
			<button
				type="button"
				className="al-row__summary"
				aria-expanded={isExpandable ? expanded : undefined}
				onClick={() => isExpandable && setExpanded((v) => !v)}
			>
				<span className={`al-row__toggle${!isExpandable ? ' al-row__toggle--hidden' : ''}`}>
					<ChevronIcon direction={expanded ? 'down' : 'right'} className="al-row__toggle-icon" />
				</span>

				<span className="al-row__op-col">
					<span className={`al-badge al-badge--op al-badge--${doc.operation}`}>
						{doc.eventType ?? OPERATION_LABELS[doc.operation] ?? doc.operation}
					</span>
					<span className="al-row__collection">{isGlobal ? doc.documentId : doc.relationTo}</span>
				</span>

				<span className="al-row__docid" title={isGlobal ? undefined : doc.documentId}>
					{isGlobal ? '—' : doc.documentId ? `#${doc.documentId.slice(-8)}` : '—'}
				</span>

				<span className="al-row__user" title={displayUser(doc.user, userTitleFields)}>
					{displayUser(doc.user, userTitleFields).slice(-20)}
				</span>

				<span className="al-row__badges">
					{doc.payloadAPI && (
						<span
							className={`al-badge al-badge--api al-badge--api-${doc.payloadAPI.toLowerCase()}`}
						>
							{doc.payloadAPI}
						</span>
					)}
					{doc.locale && <span className="al-badge al-badge--locale">{doc.locale}</span>}
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
			</button>

			<div className="al-row__body">
				<div className="al-row__detail">
					<div className="al-row__detail-inner">
						<div className="al-row__meta">
							{doc.ipAddress && (
								<span className="al-row__meta-item">
									<span className="al-row__meta-label">{t(keys.metaIp)}</span> {doc.ipAddress}
								</span>
							)}
							{doc.userAgent && (
								<span className="al-row__meta-item" title={doc.userAgent}>
									<span className="al-row__meta-label">{t(keys.metaUa)}</span>{' '}
									<span className="al-row__ua">{doc.userAgent}</span>
								</span>
							)}
							{doc.locale && (
								<span className="al-row__meta-item">
									<span className="al-row__meta-label">{t(keys.metaLocale)}</span> {doc.locale}
								</span>
							)}
							{doc.group && groupHref && (
								<span className="al-row__meta-item">
									<span className="al-row__meta-label">{t(keys.filterGroup)}</span>{' '}
									<a className="al-row__meta-group" href={groupHref}>
										{doc.group}
									</a>
								</span>
							)}
						</div>

						{doc.changedPaths && doc.changedPaths.length > 0 && (
							<div className="al-row__changed-paths">
								{doc.changedPaths.map((p) => (
									<code className="al-path-tag" key={p}>
										{p}
									</code>
								))}
							</div>
						)}

						{diff && <DiffViewer diff={diff} />}

						{hasSnapshot && (
							<div className="al-row__section">
								<div className="al-row__section-label">{t(keys.sectionSnapshot)}</div>
								<pre className="al-json-block">{JSON.stringify(doc.snapshot, null, 2)}</pre>
							</div>
						)}

						{isAuthOrCustom && (
							<div className="al-row__section">
								<div className="al-row__section-label">
									{doc.operation === 'auth' ? t(keys.sectionAuthEvent) : t(keys.sectionCustomEvent)}
								</div>
								<table className="al-diff">
									<tbody>
										{doc.eventType && (
											<tr className="al-diff__row">
												<td className="al-diff__td al-diff__col-path">
													<code className="al-diff__path">eventType</code>
												</td>
												<td className="al-diff__td" colSpan={2}>
													{doc.eventType}
												</td>
											</tr>
										)}
										{doc.relationTo && (
											<tr className="al-diff__row">
												<td className="al-diff__td al-diff__col-path">
													<code className="al-diff__path">collection</code>
												</td>
												<td className="al-diff__td" colSpan={2}>
													{doc.relationTo}
												</td>
											</tr>
										)}
										{doc.documentId && (
											<tr className="al-diff__row">
												<td className="al-diff__td al-diff__col-path">
													<code className="al-diff__path">documentId</code>
												</td>
												<td className="al-diff__td" colSpan={2}>
													{doc.documentId}
												</td>
											</tr>
										)}
									</tbody>
								</table>
								{hasMetadata && (
									<pre className="al-json-block">{JSON.stringify(doc.metadata, null, 2)}</pre>
								)}
							</div>
						)}

						{(isGlobal || doc.documentId) && (
							<div className="al-row__actions">
								<Link
									className="al-row__doc-link"
									href={
										isGlobal
											? `${adminRoute}/globals/${doc.documentId}`
											: `${adminRoute}/collections/${doc.relationTo}/${doc.documentId}`
									}
								>
									{isGlobal ? t(keys.viewGlobal) : t(keys.viewDocument)}
								</Link>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
