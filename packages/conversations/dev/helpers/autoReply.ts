import { type CollectionSlug, createLocalReq } from 'payload'

import { postMessage } from '../../src/index'
import type { ConversationsHooks } from '../../src/types'

/** Marks the request of an automatic reply, so replies never answer replies. */
const AUTO_REPLY = 'devAutoReply'

const LINES = [
	'On it, give me a minute.',
	'Thanks for the ping, I will check.',
	'Good catch. Looking now.',
	'Seen it. Will get back to you after lunch.',
	'Sure, done.',
	'Can we talk about it in the call?',
	'Agreed.',
]

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T

const paragraph = (children: object[]) => ({
	root: {
		children: [
			{
				children,
				direction: 'ltr',
				format: '',
				indent: 0,
				textFormat: 0,
				type: 'paragraph',
				version: 1,
			},
		],
		direction: 'ltr',
		format: '',
		indent: 0,
		type: 'root',
		version: 1,
	},
})

const text = (value: string) => ({
	detail: 0,
	format: 0,
	mode: 'normal',
	style: '',
	text: value,
	type: 'text',
	version: 1,
})

/**
 * Dev only: whoever is mentioned answers a few seconds later, in the same
 * channel or thread, mentioning the author back. Makes new messages, unread
 * state and mentions easy to try alone. Replies are posted on a fresh local
 * request once the original one has finished.
 */
export const autoReply =
	(instance: string): NonNullable<ConversationsHooks['afterMention']> =>
	({ channel, key, message, req, users }) => {
		if (req.context[AUTO_REPLY]) return
		const payload = req.payload
		for (const user of users) {
			const userKey = `${user.collection}:${user.id}`
			if (userKey === message.authorKey) continue
			setTimeout(
				() => {
					void (async () => {
						const author = (await payload
							.findByID({
								collection: message.authorKey.split(':')[0] as CollectionSlug,
								depth: 0,
								disableErrors: true,
								id: message.authorKey.split(':').slice(1).join(':'),
							})
							.catch(() => null)) as null | { name?: string }
						const local = await createLocalReq({ context: { [AUTO_REPLY]: true } }, payload)
						await postMessage(local, {
							author: userKey,
							body: paragraph([
								{
									label: author?.name ?? 'you',
									type: 'conversationsMention',
									userKey: message.authorKey,
									version: 1,
								},
								text(` ${pick(LINES)}`),
							]),
							channel,
							instance,
							key,
							parent: message.parent ?? null,
						})
					})().catch((error: unknown) => {
						payload.logger.error({ err: error, msg: '[dev] auto-reply failed' })
					})
				},
				2000 + Math.random() * 3000
			)
		}
	}
