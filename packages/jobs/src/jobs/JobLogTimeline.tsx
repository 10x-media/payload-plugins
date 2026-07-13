'use client'

import { Pill, useConfig, useForm } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { ArrayFieldClientProps } from 'payload'
import type { FC } from 'react'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { extractErrorMessage } from './extractErrorMessage'
import { formatDuration } from './formatDuration'
import { formatRelativeTime } from './formatRelativeTime'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

interface LogEntry {
	completedAt?: string
	error?: unknown
	executedAt?: string
	id?: string
	input?: unknown
	output?: unknown
	state?: 'failed' | 'succeeded'
	taskID?: string
	taskSlug?: string
}

const hasKeys = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && Object.keys(value).length > 0

const Chevron = ({ open }: { open: boolean }) => (
	<svg
		aria-hidden="true"
		height="10"
		style={{
			flexShrink: 0,
			transform: open ? 'rotate(90deg)' : 'none',
			transition: 'transform 0.15s',
		}}
		viewBox="0 0 10 10"
		width="10"
	>
		<path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
	</svg>
)

const Detail = ({ label, value }: { label: string; value: string }) => (
	<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
		<span
			style={{
				color: 'var(--theme-elevation-500)',
				fontSize: '0.6875rem',
				textTransform: 'uppercase',
			}}
		>
			{label}
		</span>
		<span>{value}</span>
	</div>
)

const JsonBlock = ({ label, value }: { label: string; value: unknown }) => (
	<div>
		<div
			style={{
				color: 'var(--theme-elevation-500)',
				fontSize: '0.6875rem',
				marginBottom: '2px',
				textTransform: 'uppercase',
			}}
		>
			{label}
		</div>
		<pre
			style={{
				backgroundColor: 'var(--theme-elevation-100)',
				borderRadius: '4px',
				fontSize: '0.75rem',
				margin: 0,
				maxHeight: '220px',
				overflow: 'auto',
				padding: 'calc(var(--base) / 2)',
				whiteSpace: 'pre-wrap',
				wordBreak: 'break-word',
			}}
		>
			{JSON.stringify(value, null, 2)}
		</pre>
	</div>
)

const LogRow = ({
	entry,
	index,
	pattern,
	taskLabels,
}: {
	entry: LogEntry
	index: number
	pattern: string
	taskLabels?: Record<string, string>
}) => {
	const { i18n, t } = useTranslation()
	const [open, setOpen] = useState(false)
	const failed = entry.state === 'failed'
	const reason = failed ? extractErrorMessage(entry.error) : undefined
	const duration = formatDuration(entry.executedAt, entry.completedAt)
	const relative = formatRelativeTime(entry.executedAt ?? null)
	const absolute = (date?: string): string => (date ? formatDate({ date, i18n, pattern }) : '—')

	return (
		<div
			style={{
				backgroundColor: 'var(--theme-elevation-50)',
				borderLeft: `3px solid ${failed ? 'var(--theme-error-500)' : 'var(--theme-success-500)'}`,
				borderRadius: '0 4px 4px 0',
			}}
		>
			<button
				aria-expanded={open}
				onClick={() => setOpen((prev) => !prev)}
				style={{
					alignItems: 'center',
					background: 'none',
					border: 'none',
					color: 'inherit',
					cursor: 'pointer',
					display: 'flex',
					flexWrap: 'wrap',
					font: 'inherit',
					gap: 'calc(var(--base) / 2)',
					padding: 'calc(var(--base) / 2)',
					textAlign: 'left',
					width: '100%',
				}}
				type="button"
			>
				<Chevron open={open} />
				<span style={{ color: 'var(--theme-elevation-400)' }}>#{index + 1}</span>
				<Pill pillStyle={failed ? 'error' : 'success'} size="small">
					{failed ? t(keys.statusFailed) : t(keys.statusSucceeded)}
				</Pill>
				<strong>
					{entry.taskSlug === 'inline'
						? t(keys.inlineStep, { id: entry.taskID ?? '?' })
						: taskLabels?.[entry.taskSlug ?? '']
							? `${taskLabels[entry.taskSlug ?? '']} (${entry.taskSlug} / ${entry.taskID ?? '?'})`
							: entry.taskSlug || t(keys.fieldTask)}
				</strong>
				{relative ? <span style={{ color: 'var(--theme-elevation-500)' }}>{relative}</span> : null}
				{duration ? <span style={{ color: 'var(--theme-elevation-500)' }}>{duration}</span> : null}
				{reason ? (
					<span
						style={{
							color: 'var(--theme-elevation-500)',
							maxWidth: '32ch',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{reason}
					</span>
				) : null}
			</button>
			<div
				style={{
					display: 'grid',
					gridTemplateRows: open ? '1fr' : '0fr',
					transition: 'grid-template-rows 0.2s ease',
				}}
			>
				<div style={{ overflow: 'hidden' }}>
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: 'calc(var(--base) / 2)',
							padding: '0 calc(var(--base) / 2) calc(var(--base) / 2)',
						}}
					>
						<div
							style={{ columnGap: 'var(--base)', display: 'flex', flexWrap: 'wrap', rowGap: '8px' }}
						>
							<Detail label={t(keys.fieldExecuted)} value={absolute(entry.executedAt)} />
							<Detail label={t(keys.fieldCompleted)} value={absolute(entry.completedAt)} />
							{entry.taskID ? <Detail label={t(keys.fieldTaskId)} value={entry.taskID} /> : null}
						</div>
						<JsonBlock label={t(keys.fieldInput)} value={entry.input ?? {}} />
						{hasKeys(entry.output) ? (
							<JsonBlock label={t(keys.fieldOutput)} value={entry.output} />
						) : null}
						{entry.error != null ? (
							<JsonBlock label={t(keys.fieldError)} value={entry.error} />
						) : null}
					</div>
				</div>
			</div>
		</div>
	)
}

/**
 * Field component for a job's `log`: a read-only per-attempt timeline. Each
 * attempt collapses to a one-line summary and expands to reveal its full data
 * (timings, task ID, input, output, error) so nothing is hidden.
 */
export const JobLogTimeline: FC<
	ArrayFieldClientProps & { taskLabels?: Record<string, string> }
> = ({ path, taskLabels }) => {
	const { getDataByPath } = useForm()
	const { config } = useConfig()
	const { t } = useTranslation()
	const pattern = config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT
	const raw = getDataByPath<LogEntry[]>(path)
	const entries = Array.isArray(raw) ? raw : []

	if (entries.length === 0) {
		return <div style={{ color: 'var(--theme-elevation-450)' }}>{t(keys.noAttempts)}</div>
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--base) / 2)' }}>
			{entries.map((entry, index) => (
				<LogRow
					entry={entry}
					index={index}
					key={entry.id ?? index}
					pattern={pattern}
					taskLabels={taskLabels}
				/>
			))}
		</div>
	)
}
