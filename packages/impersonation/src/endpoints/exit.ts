import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

import { expireCookie, expireCookies, expirePayloadCookie } from '../auth/cookies'
import { resignSession } from '../auth/issue'
import { isolatedCookieNameFor } from '../auth/mode'
import { collectionBySlug } from '../ids'
import { closeAndRevoke } from '../session/close'
import { releaseLocks } from '../session/locks'
import { findOpenBySid, relationOf } from '../session/resolve'
import { boundSid } from '../types'
import {
	callerSid,
	fail,
	getOptions,
	isApiKeyStrategy,
	json,
	prepareMutation,
	rejectGate,
} from './shared'

export const exitHandler = async (req: PayloadRequest): Promise<Response> => {
	const gate = await prepareMutation(req)
	if (gate) {
		return rejectGate(req, gate)
	}

	const options = getOptions(req)
	const user = req.user
	if (!user) {
		return fail({ error: 'forbidden', req, status: 403 })
	}
	if (isApiKeyStrategy(user) || !callerSid(user)) {
		return fail({ error: 'unsupportedAuth', req, status: 403 })
	}

	const sid = boundSid(user, options.session.binding)
	if (!sid) {
		return fail({ error: 'unsupportedAuth', req, status: 403 })
	}

	const row = await findOpenBySid({ options, payload: req.payload, req, sid })
	if (!row) {
		return fail({ error: 'notImpersonating', req, status: 409 })
	}

	const impersonator = relationOf(row.impersonator)
	const target = relationOf(row.target)
	const targetCollection = target ? collectionBySlug(req.payload, target.collection) : undefined
	const authConfig =
		targetCollection?.config.auth ??
		collectionBySlug(req.payload, req.payload.config.admin.user)?.config.auth
	if (!authConfig) {
		return fail({ error: 'failed', req, status: 500 })
	}

	const expireHintAndClear = expireCookies({
		authConfig,
		cookiePrefix: req.payload.config.cookiePrefix,
		names: [...options.cookies.clearOnSwitch, options.hintCookieName],
	})

	if (!impersonator || !collectionBySlug(req.payload, impersonator.collection)) {
		await closeAndRevoke({
			endedBy: 'impersonatorGone',
			options,
			payload: req.payload,
			record: row,
			req,
		})
		await releaseLocks({ payload: req.payload, record: row, req })
		return fail({
			cookies: [
				expirePayloadCookie({
					authConfig,
					cookiePrefix: req.payload.config.cookiePrefix,
				}),
				...expireHintAndClear,
			],
			error: 'impersonatorGone',
			req,
			status: 409,
		})
	}

	let impersonatorDoc: { deletedAt?: string; lockUntil?: Date | string } | null = null
	try {
		impersonatorDoc = (await req.payload.findByID({
			id: impersonator.id,
			collection: impersonator.collection as CollectionSlug,
			depth: 0,
			overrideAccess: true,
			req,
		})) as { deletedAt?: string; lockUntil?: Date | string }
	} catch {
		impersonatorDoc = null
	}

	if (!impersonatorDoc || impersonatorDoc.deletedAt) {
		await closeAndRevoke({
			endedBy: 'impersonatorGone',
			options,
			payload: req.payload,
			record: row,
			req,
		})
		await releaseLocks({ payload: req.payload, record: row, req })
		return fail({
			cookies: [
				expirePayloadCookie({
					authConfig,
					cookiePrefix: req.payload.config.cookiePrefix,
				}),
				...expireHintAndClear,
			],
			error: 'impersonatorGone',
			req,
			status: 409,
		})
	}

	if (row.mode === 'parallel') {
		const closed = await closeAndRevoke({
			endedBy: 'exit',
			options,
			payload: req.payload,
			record: row,
			req,
		})
		await releaseLocks({ payload: req.payload, record: closed, req })
		let isolatedName: string | undefined
		if (target) {
			const targetUser = (await req.payload.db.findOne({
				collection: target.collection as CollectionSlug,
				req,
				where: { id: { equals: target.id } },
			})) as { collection?: string } | null
			if (targetUser) {
				targetUser.collection = target.collection
				isolatedName = await isolatedCookieNameFor({
					collection: target.collection as CollectionSlug,
					payload: req.payload,
					user: targetUser as never,
				})
			}
		}
		return json({
			body: { ok: true },
			cookies: [
				...(isolatedName ? [expireCookie({ authConfig, name: isolatedName })] : []),
				expireCookie({ authConfig, name: options.hintCookieName }),
				...expireCookies({
					authConfig,
					cookiePrefix: req.payload.config.cookiePrefix,
					names: options.cookies.clearOnSwitch,
				}),
			],
			req,
			status: 200,
		})
	}

	const restored = await resignSession({
		collection: impersonator.collection as CollectionSlug,
		payload: req.payload,
		req,
		sid: row.impersonatorSid,
		userId: impersonator.id,
	})

	if (!restored) {
		await closeAndRevoke({
			endedBy: 'expired',
			options,
			payload: req.payload,
			record: row,
			req,
		})
		await releaseLocks({ payload: req.payload, record: row, req })
		return fail({
			cookies: [
				expirePayloadCookie({
					authConfig,
					cookiePrefix: req.payload.config.cookiePrefix,
				}),
				...expireHintAndClear,
			],
			error: 'impersonatorSessionExpired',
			req,
			status: 409,
		})
	}

	const closed = await closeAndRevoke({
		endedBy: 'exit',
		options,
		payload: req.payload,
		record: row,
		req,
	})
	await releaseLocks({ payload: req.payload, record: closed, req })

	return json({
		body: { ok: true },
		cookies: [
			restored.cookie,
			expireCookie({ authConfig, name: options.hintCookieName }),
			...expireCookies({
				authConfig,
				cookiePrefix: req.payload.config.cookiePrefix,
				names: options.cookies.clearOnSwitch,
			}),
		],
		req,
		status: 200,
	})
}

export const exitEndpoint = (path: string): Endpoint => ({
	handler: exitHandler,
	method: 'post',
	path,
})
