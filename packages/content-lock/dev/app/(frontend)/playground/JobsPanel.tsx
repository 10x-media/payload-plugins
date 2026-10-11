'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { type PlaygroundTask, queueJob } from './actions'

export type PlaygroundJob = {
	id: number | string
	task: string
	slug: string
	status: string
	deferredBy: string | null
	waitUntil: string | null
	error: string | null
	tries: number
}

const TASKS: Record<PlaygroundTask, string> = {
	playgroundWrite: 'Wait 5s, write (fails when interrupted)',
	playgroundWriteDeferred: 'Wait 5s, write (deferOnInterrupt)',
	playgroundBatch: '10 writes, 3s apart, checkpoint() before each',
}

const cell = { borderBottom: '1px solid #ddd', padding: '0.4rem', verticalAlign: 'top' } as const

/** Queue playground jobs and watch the lock pause, fail, or defer them. Refreshes every 2s. */
export const JobsPanel = ({ jobs, slugs }: { jobs: PlaygroundJob[]; slugs: string[] }) => {
	const router = useRouter()
	const [slug, setSlug] = useState(slugs[0] ?? '')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		const timer = setInterval(() => router.refresh(), 2000)
		return () => clearInterval(timer)
	}, [router])

	const queue = async (task: PlaygroundTask) => {
		setBusy(true)
		try {
			await queueJob({ slug, task })
			router.refresh()
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<p>
				Target{' '}
				<select onChange={(event) => setSlug(event.target.value)} value={slug}>
					{slugs.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>{' '}
				{(Object.keys(TASKS) as PlaygroundTask[]).map((task) => (
					<button
						disabled={busy || !slug}
						key={task}
						onClick={() => void queue(task)}
						style={{ marginRight: '0.5rem' }}
						type="button"
					>
						{TASKS[task]}
					</button>
				))}
			</p>
			<table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' }}>
				<thead>
					<tr>
						{['Job', 'Task', 'Target', 'Status', 'Tries', 'Deferred by', 'Wait until', 'Error'].map(
							(heading) => (
								<th key={heading} style={{ ...cell, textAlign: 'left' }}>
									{heading}
								</th>
							)
						)}
					</tr>
				</thead>
				<tbody>
					{jobs.map((job) => (
						<tr key={job.id}>
							<td style={cell}>
								<a href={`/admin/collections/payload-jobs/${job.id}`}>{String(job.id).slice(-6)}</a>
							</td>
							<td style={cell}>{job.task}</td>
							<td style={cell}>{job.slug}</td>
							<td style={cell}>
								<strong>{job.status}</strong>
							</td>
							<td style={cell}>{job.tries}</td>
							<td style={cell}>{job.deferredBy ?? ''}</td>
							<td style={cell}>
								{job.waitUntil ? new Date(job.waitUntil).toLocaleTimeString() : ''}
							</td>
							<td style={cell}>{job.error ?? ''}</td>
						</tr>
					))}
					{jobs.length === 0 && (
						<tr>
							<td colSpan={8} style={{ ...cell, color: '#999' }}>
								No playground jobs yet.
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</>
	)
}
