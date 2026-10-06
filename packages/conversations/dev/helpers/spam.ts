import { createLocalReq } from 'payload'

import { postMessage } from '../../src/index'
import type { ConversationsHooks } from '../../src/types'

/** Marks a spammed message, so it never starts another run. */
const SPAM = 'devSpam'

const DEFAULT_COUNT = 120
const MAX_COUNT = 500
/** Time to close the drawer or switch rooms before the flood starts. */
const START_DELAY_MS = 5000

const LINES = [
	'Heat 3 start list is updated.',
	'Can someone check the medal count?',
	'Uploading the photos now.',
	'The shuttle leaves at 7:40.',
	'Results are in, checking the times.',
	'Coffee in the media tent.',
	'Wind is picking up on the course.',
	'Moved the interview to 15:00.',
]

const COMMAND = /^\/?spam(?:\s+(\d+))?$/i

/**
 * Dev only: a message reading `spam` (or `spam 300`) makes the other staff
 * post that many messages (default 120, at most 500) into the same channel or
 * thread, starting five seconds later, a few per second. For trying a busy
 * conversation: unread counts, opening at the first unread, "N new".
 */
export const spam =
	(instance: string): NonNullable<ConversationsHooks['afterMessage']> =>
	({ message, operation, req }) => {
		const match =
			operation === 'create' && !req.context[SPAM] && message.text?.trim().match(COMMAND)
		if (!match) return
		const count = Math.min(MAX_COUNT, Number(match[1] ?? DEFAULT_COUNT) || DEFAULT_COUNT)
		const payload = req.payload
		setTimeout(() => {
			void (async () => {
				const staff = await payload.find({
					collection: 'users',
					depth: 0,
					limit: 10,
					overrideAccess: true,
					pagination: false,
				})
				const authors = staff.docs
					.map((doc) => `users:${doc.id}`)
					.filter((key) => key !== message.authorKey)
				if (authors.length === 0) return
				const local = await createLocalReq({ context: { [SPAM]: true } }, payload)
				for (let index = 0; index < count; index++) {
					await postMessage(local, {
						author: authors[index % authors.length],
						channel: message.channel,
						instance,
						key: message.key,
						parent: message.parent ?? null,
						text: `${LINES[index % LINES.length]} (${index + 1}/${count})`,
					})
					await new Promise((resolve) => setTimeout(resolve, 150))
				}
				payload.logger.info(`[dev] spam: ${count} messages in ${message.key}`)
			})().catch((error: unknown) => {
				payload.logger.error({ err: error, msg: '[dev] spam failed' })
			})
		}, START_DELAY_MS)
	}
