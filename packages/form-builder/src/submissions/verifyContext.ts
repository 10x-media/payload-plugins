import { APIError, type CollectionBeforeValidateHook } from 'payload'
import { verifyFormContext } from '../context/formContext'
import { CONTEXT_KEY } from '../spam/constants'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import type { SubmissionValue } from './types'

/**
 * beforeValidate: pull the reserved signed-context entry out of the submitted values, verify it, and
 * stamp the verified `{ relationTo, value }` on the submission's separate `context` field. Runs
 * independently of the spam config (context must work with spam off) and before `validateSubmission`
 * stores the answers, so the token never reaches `values`, the answers view, or `{{*}}` output.
 *
 * A missing context is normal (the same form on an ordinary page carries none). An invalid one is
 * rejected loudly rather than dropped to absent, so a tampered reference cannot degrade into a send to
 * the statically configured recipients, which would hide the attack. The stored `value` is a string
 * for cross-adapter consistency; the id it references is already public.
 */
export const verifyContext =
	(): CollectionBeforeValidateHook =>
	async ({ data, operation, req }) => {
		if (operation !== 'create' || !data) {
			return data
		}
		const values = Array.isArray(data.values) ? (data.values as SubmissionValue[]) : []
		const token = values.find((entry) => entry.field === CONTEXT_KEY)?.value
		// Always strip the reserved entry, verified or not, so it can never land in the answers.
		data.values = values.filter((entry) => entry.field !== CONTEXT_KEY)
		if (typeof token !== 'string' || token.length === 0) {
			return data
		}
		const verified = verifyFormContext(token, req.payload.secret)
		if (!verified) {
			throw new APIError(asTranslate(req.i18n.t)(keys.contextInvalid), 400)
		}
		data.context = { relationTo: verified.relationTo, value: String(verified.value) }
		return data
	}
