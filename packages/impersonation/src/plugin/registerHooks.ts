import type { CollectionAfterLogoutHook, Config } from 'payload'

import { expireCookie } from '../auth/cookies'
import { collectionBySlug } from '../ids'
import { closeAndRevoke } from '../session/close'
import { releaseLocks } from '../session/locks'
import { findOpenBySid } from '../session/resolve'
import type { ResolvedOptions } from '../types'
import { boundSid } from '../types'

export const registerHooks = (config: Config, options: ResolvedOptions): void => {
	const afterLogout: CollectionAfterLogoutHook = async ({ req }) => {
		try {
			const user = req.user
			const sid = boundSid(user, options.session.binding)
			if (!user || !sid) {
				return
			}
			const row = await findOpenBySid({
				options,
				payload: req.payload,
				req,
				sid,
			})
			if (!row) {
				return
			}
			const closed = await closeAndRevoke({
				endedBy: 'logout',
				options,
				payload: req.payload,
				record: row,
				req,
			})
			await releaseLocks({ payload: req.payload, record: closed, req })
			const authConfig =
				(user.collection
					? collectionBySlug(req.payload, user.collection)?.config.auth
					: undefined) ?? collectionBySlug(req.payload, req.payload.config.admin.user)?.config.auth
			if (authConfig && req.responseHeaders) {
				req.responseHeaders.append(
					'Set-Cookie',
					expireCookie({ authConfig, name: options.hintCookieName })
				)
			}
		} catch {
			// afterLogout must not fail the logout.
		}
	}

	config.collections = (config.collections ?? []).map((collection) => {
		if (!collection.auth) {
			return collection
		}
		return {
			...collection,
			hooks: {
				...collection.hooks,
				afterLogout: [...(collection.hooks?.afterLogout ?? []), afterLogout],
			},
		}
	})
}
