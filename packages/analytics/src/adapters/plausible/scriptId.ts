import type { TextFieldSingleValidation } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/**
 * What a per-site script id may be: a bare token. It lands in the page's script address, where a
 * slash or a dot segment would walk out of Plausible's script route to any path on the site.
 */
const SCRIPT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Whether `value` is a script id the adapter will use. */
export const isScriptId = (value: unknown): value is string =>
	typeof value === 'string' && SCRIPT_ID_PATTERN.test(value)

/**
 * Its own module so the providers collection validates on the adapter's terms without loading the
 * adapter. Empty is allowed: the id is optional and only turns capture on.
 */
export const validateScriptId: TextFieldSingleValidation = (value, { req }) =>
	!value || isScriptId(value) ? true : asTranslate(req.t)(keys.providerErrorScriptId)
