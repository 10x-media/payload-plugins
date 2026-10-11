import { collectionKey } from '@10x-media/conversations'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'

import { Playground } from './Playground'
import type { LiveTarget } from './stories'

/**
 * `/admin/playground`: every UI primitive of the plugin on one page, live on
 * the seeded data and on an in-memory mock. Dev app only.
 */
export const PlaygroundView = async ({
	initPageResult,
	params,
	searchParams,
}: AdminViewServerProps) => {
	const { payload, user } = initPageResult.req
	const live: LiveTarget[] = []
	if (user) {
		const [persons, media] = await Promise.all([
			payload.find({ collection: 'persons', depth: 0, limit: 5, sort: 'createdAt' }),
			payload.find({ collection: 'media', depth: 0, limit: 1, sort: 'createdAt' }),
		])
		for (const doc of persons.docs) {
			live.push({ key: collectionKey('persons', doc.id), label: `Person · ${String(doc.name)}` })
		}
		for (const doc of media.docs) {
			live.push({ key: collectionKey('media', doc.id), label: `Media · ${String(doc.title)}` })
		}
	}
	return (
		<DefaultTemplate
			i18n={initPageResult.req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			user={user ?? undefined}
			visibleEntities={initPageResult.visibleEntities}
		>
			<Gutter>{user ? <Playground live={live} /> : <p>Log in to see the playground.</p>}</Gutter>
		</DefaultTemplate>
	)
}
