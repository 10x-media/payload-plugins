import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'

import { ChatApp, type ChatRoom } from './ChatApp'

/**
 * `/admin/chat`: a Slack-like chat over the `rooms` collection, built only
 * from the plugin's primitives and hooks. An example of what a project
 * composes itself; the plugin ships no such view.
 */
export const ChatView = async ({ initPageResult, params, searchParams }: AdminViewServerProps) => {
	const { payload, user } = initPageResult.req
	const rooms: ChatRoom[] = []
	if (user) {
		const result = await payload.find({
			collection: 'rooms',
			depth: 0,
			limit: 100,
			sort: 'name',
		})
		for (const doc of result.docs) {
			rooms.push({ id: String(doc.id), name: doc.name ?? 'untitled', topic: doc.topic ?? '' })
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
			{user ? <ChatApp rooms={rooms} /> : <p>Log in to chat.</p>}
		</DefaultTemplate>
	)
}
