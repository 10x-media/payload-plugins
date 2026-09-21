import type { SubmissionContextArgs } from './submissionContext'

/** The built-in email actions `email.render` runs for. */
export type EmailActionType = 'emailTeam' | 'confirmation'

/**
 * What `email.render` receives per outgoing email: the finished body `html` (the default pipeline's
 * output, or `richText.serialize`'s when set), the raw `body` it was rendered from, the interpolated
 * `subject`, the `actionType` sending it, and the submission context: `locale` (the submission's
 * own), `form`, `submissionId`, `values`, `descriptors`, `context`, `payload`, and `req`.
 */
export type EmailRenderArgs = SubmissionContextArgs & {
	html: string
	/** The action's stored rich text (or legacy string) body config, before serialization. */
	body: unknown
	subject: string
	actionType: EmailActionType
}

/**
 * Host hook producing the final `html` of every built-in email (plugin option `email.render`), e.g.
 * to wrap the body in a branded, localized layout. It runs after the body is serialized, so it only
 * wraps and never has to re-render rich text. A throw fails the action like a send failure does.
 */
export type EmailRender = (args: EmailRenderArgs) => Promise<string> | string
