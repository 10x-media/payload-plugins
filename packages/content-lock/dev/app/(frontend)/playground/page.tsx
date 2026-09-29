import config from '@payload-config'
import { getPayload } from 'payload'

import { getContentLockState } from '../../../../src/index'
import { isEntityLocked } from '../../../../src/state/resolve'
import { type PlaygroundEntity, PlaygroundTable } from './PlaygroundTable'

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
		</main>
	)
}
