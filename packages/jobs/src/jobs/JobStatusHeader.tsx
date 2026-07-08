'use client'

import { Pill, useConfig, useFormFields } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { UIFieldClientComponent } from 'payload'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { deriveJobStatus } from './deriveJobStatus'
import { formatRelativeTime } from './formatRelativeTime'
import { jobStatusMeta } from './jobStatusMeta'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

const Fact = ({ label, tooltip, value }: { label: string; tooltip?: string; value: string }) => {
	const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
			<span
				style={{
					color: 'var(--theme-elevation-500)',
					fontSize: '0.6875rem',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
				}}
			>
				{label}
			</span>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: supplementary hover tooltip on a read-only text value */}
			<span
				onMouseEnter={(event) => {
					if (!tooltip) {
						return
					}
					const rect = event.currentTarget.getBoundingClientRect()
					setCoords({ left: rect.left, top: rect.bottom })
				}}
				onMouseLeave={() => setCoords(null)}
				style={{ cursor: tooltip ? 'help' : undefined, fontWeight: 600, width: 'fit-content' }}
			>
				{value}
			</span>
			{mounted && tooltip && coords
				? createPortal(
						<span
							style={{
								backgroundColor: 'var(--theme-elevation-900)',
								borderRadius: '4px',
								boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
								color: 'var(--theme-elevation-0)',
								fontSize: '0.75rem',
								left: `${coords.left}px`,
								padding: '4px 8px',
								pointerEvents: 'none',
								position: 'fixed',
								top: `${coords.top + 6}px`,
								whiteSpace: 'nowrap',
								zIndex: 9999,
							}}
						>
							{tooltip}
						</span>,
						document.body
					)
				: null}
		</div>
	)
}

/**
 * Document header for a job: the derived status as a Pill plus the key facts,
 * read from the form so it stays in sync. Rendered at the top of the edit view.
 */
export const JobStatusHeader: UIFieldClientComponent = () => {
	const fields = useFormFields(([formFields]) => formFields)
	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const get = (name: string): unknown => fields?.[name]?.value

	const status = deriveJobStatus({
		completedAt: get('completedAt') as null | string,
		error: get('error'),
		hasError: get('hasError') as boolean,
		processing: get('processing') as boolean,
		totalTried: get('totalTried') as number,
		waitUntil: get('waitUntil') as null | string,
	})
	const meta = jobStatusMeta[status]

	const workflowSlug = get('workflowSlug')
	const taskSlug = get('taskSlug')
	const runsLabel = workflowSlug
		? t(keys.fieldWorkflow)
		: taskSlug
			? t(keys.fieldTask)
			: t(keys.fieldJob)
	const runsValue = String(workflowSlug || taskSlug || '—')

	const pattern = config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT
	const createdAt = get('createdAt') as null | string
	const completedAt = get('completedAt') as null | string
	const absolute = (date: null | string): string | undefined =>
		date ? formatDate({ date, i18n, pattern }) : undefined

	return (
		<div
			style={{
				alignItems: 'flex-end',
				borderBottom: '1px solid var(--theme-elevation-100)',
				columnGap: 'calc(var(--base) * 1.5)',
				display: 'flex',
				flexWrap: 'wrap',
				marginBottom: 'var(--base)',
				paddingBottom: 'var(--base)',
				rowGap: 'var(--base)',
			}}
		>
			<Pill pillStyle={meta.pillStyle} size="medium">
				{t(meta.labelKey)}
			</Pill>
			<Fact label={runsLabel} value={runsValue} />
			<Fact label={t(keys.fieldQueue)} value={String(get('queue') || 'default')} />
			<Fact label={t(keys.fieldAttempts)} value={String((get('totalTried') as number) ?? 0)} />
			<Fact
				label={t(keys.fieldCreated)}
				tooltip={absolute(createdAt)}
				value={formatRelativeTime(createdAt, Date.now(), i18n.language) || '—'}
			/>
			<Fact
				label={t(keys.fieldCompleted)}
				tooltip={absolute(completedAt)}
				value={completedAt ? formatRelativeTime(completedAt, Date.now(), i18n.language) : '—'}
			/>
		</div>
	)
}
