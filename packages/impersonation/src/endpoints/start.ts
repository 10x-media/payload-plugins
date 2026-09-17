import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

import { expireCookies, generateHintCookie } from '../auth/cookies'
import { issueSession } from '../auth/issue'
import { revokeSession } from '../auth/revoke'
import {
	clearOnSwitchWithoutTenant,
	readTenantCookie,
	startTenantCookies,
} from '../auth/tenantCookie'
import { asId, collectionBySlug, idsEqual } from '../ids'
import { REASON_MAX_LENGTH } from '../plugin/constants'
import { isStartableAuthCollection } from '../plugin/startable'
import { closeRecord } from '../session/close'
import {
	findOpenByImpersonatorSid,
	findOpenByTargetSid,
	openByImpersonatorSid,
	sameUser,
} from '../session/resolve'
import type { ImpersonationRecord, ResolvedOptions } from '../types'
import { boundSid } from '../types'
import {
	callerSid,
	defaultRedirect,
	fail,
	getOptions,
	isApiKeyStrategy,
	isLiteralTrue,
	json,
	prepareMutation,
	rejectGate,
	safeRedirect,
	trimReason,
} from './shared'

const allowedTargets = (req: PayloadRequest, options: ResolvedOptions): Set<string> =>
	new Set(
		Object.values(req.payload.collections)
			.filter((collection) => isStartableAuthCollection(collection.config, options))
			.map((collection) => collection.config.slug)
	)

export const startHandler = async (req: PayloadRequest): Promise<Response> => {
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

	const nested =
		(await findOpenByTargetSid({ options, payload: req.payload, req, sid })) ??
		(await findOpenByImpersonatorSid({ options, payload: req.payload, req, sid }))
	if (nested) {
		return fail({ error: 'alreadyImpersonating', req, status: 409 })
	}

	const body = (req.data ?? {}) as Record<string, unknown>
	const collection = typeof body.collection === 'string' ? body.collection : ''
	const targetId = asId(body.id)
	if (!collection || targetId == null) {
		return fail({ error: 'invalidBody', req, status: 400 })
	}

	if (!allowedTargets(req, options).has(collection)) {
		return fail({ error: 'unsupportedCollection', req, status: 400 })
	}

	const registered = collectionBySlug(req.payload, collection)
	if (!registered) {
		return fail({ error: 'targetNotFound', req, status: 404 })
	}

	if (sameUser(user, collection, targetId)) {
		return fail({ error: 'selfTarget', req, status: 400 })
	}

	const supportsTrash = Boolean((registered.config as { trash?: boolean }).trash)
	let existing: Record<string, unknown> | null = null
	try {
		existing = (await req.payload.findByID({
			id: targetId,
			collection: collection as CollectionSlug,
			depth: 0,
			overrideAccess: true,
			req,
			...(supportsTrash ? { trash: true } : {}),
		})) as unknown as Record<string, unknown>
	} catch {
		existing = null
	}
	if (!existing) {
		return fail({ error: 'forbidden', req, status: 403 })
	}

	let readable: Record<string, unknown> | null = null
	try {
		readable = (await req.payload.findByID({
			id: targetId,
			collection: collection as CollectionSlug,
			depth: 0,
			overrideAccess: false,
			req,
		})) as unknown as Record<string, unknown>
	} catch {
		readable = null
	}

	let allowed: unknown
	try {
		allowed = await options.access.impersonate({
			req,
			target: readable ?? existing,
			targetCollection: collection as CollectionSlug,
		})
	} catch {
		return fail({ error: 'failed', req, status: 500 })
	}
	if (!isLiteralTrue(allowed)) {
		return fail({ error: 'forbidden', req, status: 403 })
	}

	if (existing.deletedAt) {
		return fail({ error: 'targetTrashed', req, status: 403 })
	}
	if (!readable) {
		return fail({ error: 'forbidden', req, status: 403 })
	}

	if (registered.config.auth.verify && readable._verified !== true) {
		return fail({ error: 'targetUnverified', req, status: 403 })
	}

	const reason = trimReason(body.reason, REASON_MAX_LENGTH)
	if (options.reason === 'required' && !reason) {
		return fail({ error: 'reasonRequired', req, status: 400 })
	}

	const issue = options.session.issue ?? issueSession
	const revoke = options.session.revoke ?? revokeSession
	let minted: Awaited<ReturnType<typeof issueSession>>
	try {
		minted = await issue({
			collection: collection as CollectionSlug,
			payload: req.payload,
			req,
			userId: targetId,
		})
	} catch (error) {
		req.payload.logger.error({
			err: error,
			msg: '@10x-media/impersonation: start failed to mint',
		})
		return fail({ error: 'failed', req, status: 500 })
	}

	const now = new Date()
	const absoluteExpiresAt =
		typeof options.maxDuration === 'number'
			? new Date(now.getTime() + options.maxDuration * 1000).toISOString()
			: undefined

	const locale =
		(req as PayloadRequest & { i18n?: { language?: string } }).i18n?.language ??
		req.payload.config.i18n?.fallbackLanguage ??
		'en'

	try {
		const row = (await req.payload.create({
			collection: options.collectionSlug,
			data: {
				absoluteExpiresAt,
				impersonator: { relationTo: user.collection, value: user.id },
				impersonatorEmail: typeof user.email === 'string' ? user.email : undefined,
				impersonatorLocale: locale,
				impersonatorSid: sid,
				impersonatorTenantCookie: readTenantCookie(req.headers, req.payload.config.cookiePrefix),
				ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
				mode: minted.mode,
				reason: options.reason === 'off' ? undefined : reason,
				startedAt: now.toISOString(),
				target: { relationTo: collection, value: targetId },
				targetEmail:
					typeof readable.email === 'string'
						? readable.email
						: typeof minted.user.email === 'string'
							? minted.user.email
							: undefined,
				targetLocked: Boolean(readable.lockUntil),
				targetSid: minted.sid,
				userAgent: req.headers.get('user-agent') ?? undefined,
			} as never,
			depth: 0,
			overrideAccess: true,
			req,
		})) as unknown as ImpersonationRecord

		const siblings = await req.payload.find({
			collection: options.collectionSlug,
			depth: 0,
			limit: 2,
			overrideAccess: true,
			pagination: false,
			req,
			sort: 'startedAt',
			where: openByImpersonatorSid(sid),
		})
		const winner = [...(siblings.docs as unknown as ImpersonationRecord[])].sort((left, right) => {
			const byTime = String(left.startedAt).localeCompare(String(right.startedAt))
			return byTime !== 0 ? byTime : String(left.id).localeCompare(String(right.id))
		})[0]
		if (siblings.totalDocs > 1 && winner && !idsEqual(winner.id, row.id)) {
			await closeRecord({ endedBy: 'failed', options, payload: req.payload, record: row, req })
			await revoke({
				collection: collection as CollectionSlug,
				payload: req.payload,
				req,
				sid: minted.sid,
				userId: targetId,
			})
			return fail({ error: 'alreadyImpersonating', req, status: 409 })
		}

		await options.onStart?.({ payload: req.payload, record: row, req })

		const authConfig = registered.config.auth
		const cookiePrefix = req.payload.config.cookiePrefix
		const cookies = [
			minted.cookie,
			generateHintCookie({
				authConfig,
				name: options.hintCookieName,
				value: String(row.id),
			}),
			...startTenantCookies({
				authConfig,
				cookiePrefix,
				mode: minted.mode,
				options,
				target: readable,
			}),
			...expireCookies({
				authConfig,
				cookiePrefix,
				names: clearOnSwitchWithoutTenant(options.cookies.clearOnSwitch, cookiePrefix).filter(
					(name) => name !== minted.cookieName
				),
			}),
		]

		const redirect = safeRedirect(body.redirect, defaultRedirect(req, collection))
		const bodyOut: Record<string, unknown> = {
			exp: minted.exp,
			redirect,
			user: readable,
		}
		if (!authConfig.removeTokenFromResponses) {
			bodyOut.token = minted.token
		}

		return json({ body: bodyOut, cookies, req, status: 200 })
	} catch (error) {
		req.payload.logger.error({
			err: error,
			msg: '@10x-media/impersonation: start failed after mint',
		})
		try {
			await revoke({
				collection: collection as CollectionSlug,
				payload: req.payload,
				req,
				sid: minted.sid,
				userId: targetId,
			})
		} catch (revokeError) {
			req.payload.logger.error({
				err: revokeError,
				msg: '@10x-media/impersonation: compensating revoke failed',
			})
		}
		return fail({ error: 'failed', req, status: 500 })
	}
}

export const startEndpoint = (path: string): Endpoint => ({
	handler: startHandler,
	method: 'post',
	path,
})
