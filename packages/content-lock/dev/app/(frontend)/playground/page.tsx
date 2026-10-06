import { deriveJobStatus } from '@10x-media/jobs'
import config from '@payload-config'
import { getPayload } from 'payload'

import { getContentLockState } from '../../../../src/index'
import { isEntityLocked } from '../../../../src/state/resolve'
import { JobsPanel, type PlaygroundJob } from './JobsPanel'
import { type PlaygroundEntity, PlaygroundTable } from './PlaygroundTable'

type JobDoc = {
	id: number | string
	taskSlug?: null | string
	input?: { slug?: string } | null
	processing?: boolean | null
	hasError?: boolean | null
	completedAt?: null | string
	totalTried?: null | number
	waitUntil?: null | string
	deferredBy?: null | string
	error?: { message?: string } | null
}

const loadJobs = async (payload: Awaited<ReturnType<typeof getPayload>>) => {
	const { docs } = await payload.find({
		collection: 'payload-jobs',
		depth: 0,
		limit: 15,
		overrideAccess: true,
		sort: '-createdAt',
		where: { taskSlug: { like: 'playground' } },
	})
	return (docs as unknown as JobDoc[]).map(
		(job): PlaygroundJob => ({
			id: job.id,
			task: job.taskSlug ?? '',
			slug: job.input?.slug ?? '',
			status: deriveJobStatus(job),
			deferredBy: job.deferredBy ?? null,
			waitUntil: job.waitUntil ?? null,
			error: job.error?.message ?? null,
			tries: job.totalTried ?? 0,
		})
	)
}

export const dynamic = 'force-dynamic'

/**
 * Dev playground: try a write against every collection and global over REST
 * (with the admin session) and over the Local API (with and without
 * `overrideAccess`), and see what the lock answers.
 */
export default async function PlaygroundPage() {
	const payload = await getPayload({ config })
	const state = await getContentLockState(payload)
	const entities: PlaygroundEntity[] = [
		...payload.config.collections
			// Internal collections, and the lock collection itself: creating a
			// published lock from here would lock the playground.
			.filter((collection) => !collection.slug.startsWith('payload-'))
			.filter((collection) => collection.slug !== 'content-locks')
			.map((collection) => ({ kind: 'collection' as const, slug: collection.slug })),
		...payload.config.globals.map((global) => ({ kind: 'global' as const, slug: global.slug })),
	].map((entity) => ({
		...entity,
		locked: isEntityLocked(state, { type: entity.kind, slug: entity.slug }),
	}))

	return (
		<main>
			<h1 style={{ marginTop: 0 }}>Content lock playground</h1>
			<p>
				Sign in to the <a href="/admin">admin</a> first: REST calls reuse its session, and the Local
				API without <code>overrideAccess</code> runs as that user.
			</p>
			<h2>Lock state</h2>
			<p>
				<strong>{state.locked ? 'Locked' : 'Unlocked'}</strong>
				{state.locked && (
					<>
						{' '}
						(
						{state.scope.everything
							? 'everything'
							: [...state.scope.collections, ...state.scope.globals].join(', ')}
						), ends {state.endsAt ?? 'manually'}
					</>
				)}
				. Active: {state.active.map((window) => window.title).join(', ') || 'none'}. Announced:{' '}
				{state.announced.map((window) => window.title).join(', ') || 'none'}.
			</p>
			<h2>Writes</h2>
			<PlaygroundTable entities={entities} />
			<h2>Jobs</h2>
			<p>
				The dev worker runs queued jobs every 2s. A lock on everything pauses every queue; a partial
				lock keeps them running. A job that writes into a lock fails, or goes back to the queue
				until the lock ends when it opted in. "End now" releases deferred jobs right away.
			</p>
			<JobsPanel
				jobs={await loadJobs(payload)}
				slugs={entities
					.filter((entity) => entity.kind === 'collection')
					.map((entity) => entity.slug)}
			/>
		</main>
	)
}
