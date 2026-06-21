import {
	APIError,
	type CollectionBeforeOperationHook,
	type CollectionBeforeValidateHook,
} from 'payload'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import type { ResolvedSpamConfig } from './types'

/**
 * Stamp the resolved request identity onto a new upload's `owner`. `captureFileRef` later requires the
 * referencing submission's identity to match, so an anonymous submitter cannot capture another identity's
 * upload. No identity (no user, no trusted IP header) means no stamp, so the upload stays unscoped (a
 * deliberate fail-open; identity granularity is IP-level, so same-network clients share scope -- documented).
 */
export const buildUploadOwnerStamp =
	(spam: ResolvedSpamConfig): CollectionBeforeValidateHook =>
	async ({ data, operation, req }) => {
		if (operation !== 'create' || !data) {
			return data
		}
		const identity = await spam.identify(req)
		if (identity != null && (data as { owner?: unknown }).owner == null) {
			;(data as { owner?: string }).owner = identity
		}
		return data
	}

/** Reject upload floods per identity before the file is written to `staticDir`. Fail-open without identity. */
export const buildUploadRateLimit =
	(spam: ResolvedSpamConfig): CollectionBeforeOperationHook =>
	async ({ operation, req }) => {
		if (operation !== 'create' || spam.uploadRateLimit === false) {
			return
		}
		const identity = await spam.identify(req)
		if (identity == null) {
			return
		}
		const { ok } = await spam.uploadRateLimit.limiter.check({
			key: `uploads:${identity}`,
			max: spam.uploadRateLimit.max,
			window: spam.uploadRateLimit.window,
			req,
		})
		if (!ok) {
			throw new APIError(asTranslate(req.i18n.t)(keys.spamRateLimited), 429)
		}
	}
