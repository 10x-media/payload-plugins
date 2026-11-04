'use client'

import { Pill, Tooltip, useConfig, useFormFields } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { UIFieldClientProps } from 'payload'
import type { FC } from 'react'
import { useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { deriveJobStatus } from './deriveJobStatus'
import { formatRelativeTime } from './formatRelativeTime'
import { jobStatusMeta } from './jobStatusMeta'
import './jobs.css'

const DEFAULT_DATE_FORMAT = 'MMMM do yyyy, h:mm a'

const Fact = ({ label, tooltip, value }: { label: string; tooltip?: string; value: string }) => {
	const [hovered, setHovered] = useState(false)

	return (
		<div className="jobs-fact">
			<span className="jobs-caption">{label}</span>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: supplementary hover tooltip on a read-only text value */}
			<span
				className={`jobs-fact__value${tooltip ? ' jobs-help' : ''}`}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
			>
				{value}
				{tooltip ? (
					<Tooltip alignCaret="left" position="bottom" show={hovered}>
						{tooltip}
					</Tooltip>
				) : null}
			</span>
		</div>
	)
}

/**
 * Document header for a job: the derived status as a Pill plus the key facts,
 * read from the form so it stays in sync. Rendered at the top of the edit view.
 */
export const JobStatusHeader: FC<
	UIFieldClientProps & {
		taskLabels?: Record<string, string>
		workflowLabels?: Record<string, string>
	}
> = ({ taskLabels, workflowLabels }) => {
	const fields = useFormFields(([formFields]) => formFields)
	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const get = (name: string): unknown => fields?.[name]?.value

	const status = deriveJobStatus({
		completedAt: get('completedAt') as null | string,
		error: get('error'),
		hasError: get('hasError') as boolean,
		processingUntil: get('processingUntil') as null | string,
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
	const runsSlug = String(workflowSlug || taskSlug || '—')
	const runsFriendly =
		(typeof workflowSlug === 'string' && workflowLabels?.[workflowSlug]) ||
		(typeof taskSlug === 'string' && taskLabels?.[taskSlug]) ||
		undefined
	const runsValue = runsFriendly ?? runsSlug

	const pattern = config.admin?.dateFormat ?? DEFAULT_DATE_FORMAT
	const createdAt = get('createdAt') as null | string
	const completedAt = get('completedAt') as null | string
	const waitUntil = get('waitUntil') as null | string
	const absolute = (date: null | string): string | undefined =>
		date ? formatDate({ date, i18n, pattern }) : undefined

	return (
		<div className="jobs-status-header">
			<Pill pillStyle={meta.pillStyle} size="medium">
				{t(meta.labelKey)}
			</Pill>
			<Fact label={runsLabel} tooltip={runsFriendly ? runsSlug : undefined} value={runsValue} />
			<Fact label={t(keys.fieldQueue)} value={String(get('queue') || 'default')} />
			<Fact
				label={t(keys.fieldAttempts)}
				tooltip={t(keys.attemptsTooltip)}
				value={String((get('totalTried') as number) ?? 0)}
			/>
			{status === 'scheduled' && waitUntil ? (
				<Fact
					label={t(keys.fieldScheduledFor)}
					tooltip={absolute(waitUntil)}
					value={formatRelativeTime(waitUntil, Date.now(), i18n.language) || '—'}
				/>
			) : null}
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
