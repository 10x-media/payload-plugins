/**
 * `req.context` key the dispatcher sets to `true` when an essential action failed (or outlived its
 * deadline) for the submission this request created. The submit endpoint reads it to turn the 201
 * into an error response; the submission itself stays stored, prune included, so a failed handoff
 * to a provider never deletes the only copy of what the visitor sent. A leaf module (no imports)
 * because both the dispatcher and the submit endpoint need it across an import cycle.
 */
export const ESSENTIAL_ACTION_FAILED_CONTEXT_KEY = 'formBuilderEssentialActionFailed'

/**
 * Set instead of the failed key when the essential pass outlived its deadline: the work may still
 * complete, so the visitor is told the outcome is unknown (504), not that it failed (502). The two
 * are different facts and prompt different visitor behavior (wait vs retry).
 */
export const ESSENTIAL_ACTION_UNCERTAIN_CONTEXT_KEY = 'formBuilderEssentialActionUncertain'
