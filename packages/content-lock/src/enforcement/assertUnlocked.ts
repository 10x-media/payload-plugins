import type { PayloadRequest } from 'payload'
import { optionsFromConfig } from '../options'
import { entityOf, isEntityLocked, scopeCovers, scopeOf } from '../state/resolve'
import { getContentLockState } from '../state/store'
import type { ContentLockState, ContentLockTarget, EntityRef } from '../state/types'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { isLockLifted } from './bypass'
import { ContentLockedError } from './ContentLockedError'

/**
 * Read the lock state, failing closed: when it cannot be read, every entity
 * counts as locked, because letting a write through during a migration loses
 * it for good.
 */
export const readStateOrLocked = async (req: PayloadRequest): Promise<ContentLockState> => {
	try {
		return await getContentLockState(req.payload)
	} catch (error) {
		req.payload.logger.error({
			err: error,
			msg: '[content-lock] cannot read lock state, failing closed',
		})
		return {
			locked: true,
			scope: { everything: true },
			endsAt: null,
			active: [],
			announced: [],
			resolvedAt: new Date().toISOString(),
			exempt: [],
		}
	}
}

/** Throw `ContentLockedError` when `entity` is frozen, unless the caller runs inside `withoutContentLock`. */
export const assertUnlocked = async (req: PayloadRequest, entity: EntityRef): Promise<void> => {
	if (isLockLifted()) {
		return
	}
	const state = await readStateOrLocked(req)
	if (!isEntityLocked(state, entity)) {
		return
	}
	const { groups } = optionsFromConfig(req.payload.config)
	const lockIds = state.active
		.filter((window) => scopeCovers(scopeOf(window, groups), entity))
		.map((window) => window.id)
	const message =
		typeof req.t === 'function' ? asTranslate(req.t)(keys.errorLocked) : en[keys.errorLocked]
	throw new ContentLockedError(message, {
		endsAt: state.endsAt,
		lockIds,
	})
}

/**
 * Throw the lock's own `ContentLockedError` when `target` is frozen, for code that must not start
 * work a lock would stop halfway: a job that catches write errors per item, or one that pays for
 * an external call before it writes. A job sees it like a blocked write, so it defers or fails per
 * its interruption policy. Exempt collections and globals never throw, nor does code running
 * inside `withoutContentLock`.
 */
export const assertContentUnlocked = (
	req: PayloadRequest,
	target: ContentLockTarget
): Promise<void> => assertUnlocked(req, entityOf(target))
