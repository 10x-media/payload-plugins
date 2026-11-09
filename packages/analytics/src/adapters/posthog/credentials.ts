import type { TextFieldSingleValidation } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/** PostHog's key prefixes (posthog/models/utils.py): a project token is public, phx_ and phs_ keys are private. */
const PROJECT_TOKEN_PREFIX = 'phc_'
const PRIVATE_KEY_PREFIXES = ['phx_', 'phs_']

/**
 * Catches a project token pasted into the personal API key field. Empty passes: on a stored document
 * it keeps the saved key.
 */
export const validatePersonalApiKey: TextFieldSingleValidation = (value, { req }) =>
	value?.trim().startsWith(PROJECT_TOKEN_PREFIX)
		? asTranslate(req.t)(keys.providerErrorPosthogTokenAsApiKey)
		: true

/**
 * Catches a private key pasted into the project token field, which the tracker config serves to
 * every visitor's browser.
 */
export const validateProjectToken: TextFieldSingleValidation = (value, { req }) =>
	PRIVATE_KEY_PREFIXES.some((prefix) => value?.trim().startsWith(prefix))
		? asTranslate(req.t)(keys.providerErrorPosthogKeyAsToken)
		: true
