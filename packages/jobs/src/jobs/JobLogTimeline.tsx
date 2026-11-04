'use client'

import { Pill, useConfig, useForm } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { ArrayFieldClientProps } from 'payload'
import type { FC, ReactNode } from 'react'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { extractErrorMessage } from './extractErrorMessage'
import { formatDuration } from './formatDuration'
import { formatRelativeTime } from './formatRelativeTime'
import { hasKeys } from './hasKeys'
import type { JobLogEntry, JobLogRenderedEntries, JobLogRenderedSlots } from './logSlotComponents'
import { logRowKey } from './logSlotComponents'
import './jobs.css'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

const Chevron = ({ open }: { open: boolean }) => (
	<svg
		aria-hidden="true"
		className={`jobs-log__chevron${open ? ' jobs-log__chevron--open' : ''}`}
		height="10"
		viewBox="0 0 10 10"
		width="10"
	>
		<path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
	</svg>
)

const Detail = ({ label, value }: { label: string; value: string }) => (
	<div className="jobs-log__detail">
		<span className="jobs-caption">{label}</span>
		<span>{value}</span>
	</div>
)

/**
 * One labelled block of an expanded attempt. `node` is a server-rendered custom
 * component for this slot; without one the value falls back to a JSON dump. The
 * label and the surrounding frame stay ours either way.
 */
const Block = ({ label, node, value }: { label: string; node?: ReactNode; value: unknown }) => (
	<div className="jobs-log__block">
		<div className="jobs-caption">{label}</div>
		{node ?? <pre className="jobs-log__json">{JSON.stringify(value, null, 2)}</pre>}
	</div>
)

const LogRow = ({
	entry,
	index,
	pattern,
	slots,
	taskLabels,
}: {
	entry: JobLogEntry
	index: number
	pattern: string
	slots?: JobLogRenderedSlots
	taskLabels?: Record<string, string>
}) => {
	const { i18n, t } = useTranslation()
	const [open, setOpen] = useState(false)
	const failed = entry.state === 'failed'
	const reason = failed ? extractErrorMessage(entry.error) : undefined
	const duration = formatDuration(entry.executedAt, entry.completedAt)
	const relative = formatRelativeTime(entry.executedAt ?? null)
	// A custom renderer relaxes the emptiness gate, so an attempt that returned an
	// empty object still gets a block, but it never invents one for a value the
	// attempt does not carry at all.
	const showOutput = slots?.output ? entry.output != null : hasKeys(entry.output)
	const absolute = (date?: string): string => (date ? formatDate({ date, i18n, pattern }) : '—')

	return (
		<div className={`jobs-log__row${failed ? ' jobs-log__row--failed' : ''}`}>
			<button
				aria-expanded={open}
				className="jobs-reset-button jobs-log__summary"
				onClick={() => setOpen((prev) => !prev)}
				type="button"
			>
				<Chevron open={open} />
				<span className="jobs-log__index">#{index + 1}</span>
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
				{relative ? <span className="jobs-muted">{relative}</span> : null}
				{duration ? <span className="jobs-muted">{duration}</span> : null}
				{reason ? <span className="jobs-log__reason">{reason}</span> : null}
			</button>
			<div className={`jobs-log__details${open ? ' jobs-log__details--open' : ''}`}>
				<div>
					<div className="jobs-log__body">
						<div className="jobs-log__facts">
							<Detail label={t(keys.fieldExecuted)} value={absolute(entry.executedAt)} />
							<Detail label={t(keys.fieldCompleted)} value={absolute(entry.completedAt)} />
							{entry.taskID ? <Detail label={t(keys.fieldTaskId)} value={entry.taskID} /> : null}
						</div>
						<Block label={t(keys.fieldInput)} node={slots?.input} value={entry.input ?? {}} />
						{showOutput ? (
							<Block label={t(keys.fieldOutput)} node={slots?.output} value={entry.output} />
						) : null}
						{entry.error != null ? (
							<Block label={t(keys.fieldError)} node={slots?.error} value={entry.error} />
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
 *
 * `renderedSlots` carries custom blocks pre-rendered by `JobLogTimelineServer`;
 * an attempt with no entry there falls back to the default JSON blocks, which is
 * also what happens when this component is mounted directly.
 */
export const JobLogTimeline: FC<
	ArrayFieldClientProps & {
		renderedSlots?: JobLogRenderedEntries
		taskLabels?: Record<string, string>
	}
> = ({ path, renderedSlots, taskLabels }) => {
	const { getDataByPath } = useForm()
	const { config } = useConfig()
	const { t } = useTranslation()
	const pattern = config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT
	const raw = getDataByPath<JobLogEntry[]>(path)
	const entries = Array.isArray(raw) ? raw : []

	if (entries.length === 0) {
		return <div className="jobs-muted">{t(keys.noAttempts)}</div>
	}

	return (
		<div className="jobs-log">
			{entries.map((entry, index) => (
				<LogRow
					entry={entry}
					index={index}
					key={logRowKey(entry, index)}
					pattern={pattern}
					slots={renderedSlots?.[logRowKey(entry, index)]}
					taskLabels={taskLabels}
				/>
			))}
		</div>
	)
}
