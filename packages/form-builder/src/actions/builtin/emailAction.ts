import type { Field, RichTextField } from 'payload'
import type { DepartmentEmailsResolver } from '../../email/departments'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { type ActionDefinition, defineAction } from '../defineAction'
import {
	buildRecipientField,
	type RecipientsConfig,
	resolveRecipientEntries,
} from '../emailRecipients'
import type { EmailActionType, EmailRender } from '../emailRender'
import {
	buildFromField,
	type FromAddressesResolver,
	type FromAddressSourceRegistry,
	resolveSendFrom,
} from '../fromAddresses'
import {
	type RecipientResolveArgs,
	type RecipientSource,
	type RecipientSourceRegistry,
	sourcesByValue,
} from '../recipientSources'

/** The plugin-derived options every built-in email action is built from (was five positional args). */
export type EmailActionOptions = {
	localize: boolean
	/**
	 * Localize the recipient lists (`to`, `cc`, `bcc`, `replyTo`) too, so each locale routes to its
	 * own addresses (plugin option `email.localizeRecipients`). Off by default: routing is usually
	 * the same in every locale, and a list left empty in one locale would otherwise fail `emailTeam`
	 * there. Only applies while `localize` is on.
	 */
	localizeRecipients?: boolean
	editor?: RichTextField['editor']
	fromAddresses?: FromAddressesResolver
	/** Send-time-resolved senders offered in the from select (plugin option `email.fromSources`). */
	fromSources?: FromAddressSourceRegistry
	departments?: DepartmentEmailsResolver
	recipients?: RecipientsConfig
	/** Server-resolved recipient sources offered in every recipient list (plugin option `email.recipientSources`). */
	recipientSources?: RecipientSourceRegistry
	/** Produces the final html from the serialized body (plugin option `email.render`). */
	render?: EmailRender
}

/** The config fields shared by every built-in email action (each action adds its own `to` target). */
export type EmailActionConfig = {
	from?: string
	cc?: string[]
	bcc?: string[]
	replyTo?: string[]
	subject?: string
	body?: unknown
}

/** Builds a recipient-list field (`to`/`cc`/`bcc`/`replyTo`) with the shared width, endpoint, and options. */
type RecipientFieldBuilder = (name: string, labelKey: string) => Field

type Resolver = ReturnType<typeof resolverFor>

/**
 * Whether serialized body html carries anything beyond markup and whitespace: an empty editor
 * serializes to bare tags, while a lone image or rule is content even without text.
 */
const hasVisibleContent = (html: string): boolean =>
	/<(img|hr|table|iframe|video|svg)\b/i.test(html) ||
	html.replace(/<[^>]*>|&nbsp;/g, '').trim() !== ''

/** What `resolveTo` needs to compute the primary target, including server-resolved sources. */
type ResolveToArgs<TConfig extends EmailActionConfig> = {
	config: TConfig
	resolve: Resolver
	sources: Map<string, RecipientSource>
	sourceArgs: RecipientResolveArgs
}

/** What distinguishes one email action from another: identity, its primary target, and how it resolves/guards that target. */
type EmailActionSpec<TConfig extends EmailActionConfig> = {
	type: EmailActionType
	label: string
	/** The first cell of the opening row (paired with `replyTo`): a recipient list, or an email-field select. */
	target: (recip: RecipientFieldBuilder) => Field
	/** Resolve the primary `to` to a comma-joined address string, or `''` when nothing resolves. */
	resolveTo: (args: ResolveToArgs<TConfig>) => Promise<string> | string
	/**
	 * Whether the author configured any target at all. A configured target that resolves empty (e.g. a
	 * source returned `[]`) is a normal skip; only a target the author never set is a misconfiguration.
	 */
	hasTarget: (config: TConfig) => boolean
	/** With no target authored, `emailTeam` treats it as a misconfiguration (`throw`), `confirmation` as a silent skip. */
	onMissingTo: 'throw' | 'skip'
}

/**
 * The shared skeleton of the built-in email actions (`emailTeam`, `confirmation`): an identical
 * config (a first row pairing the action's target with `replyTo`, an optional `from` select, a
 * cc/bcc row, a subject, and a rich text body, content fields carrying `localized` when `localize`
 * and recipient fields only when `localizeRecipients` too) and an identical send (interpolate the
 * subject, render the body, fail on an email with neither, resolve cc/bcc/replyTo, pass the html
 * through `options.render` when set, and hand a single comma-joined string per list to
 * `payload.sendEmail`). Only the primary `to` target and its missing-value behavior differ,
 * threaded through `spec`.
 */
export const buildEmailAction = <TConfig extends EmailActionConfig>(
	options: EmailActionOptions,
	spec: EmailActionSpec<TConfig>
): ActionDefinition<TConfig> => {
	const {
		localize,
		localizeRecipients,
		editor,
		fromAddresses,
		fromSources,
		departments,
		recipients,
		recipientSources,
		render,
	} = options
	const fromSourcesByValue = sourcesByValue(fromSources)
	const endpoint = departments ? 'departments' : undefined
	const recip: RecipientFieldBuilder = (name, labelKey) =>
		buildRecipientField(name, labelKey, localize && localizeRecipients === true, {
			endpoint,
			recipients,
			width: '50%',
			departments,
			sources: recipientSources,
		})
	return defineAction<TConfig>({
		type: spec.type,
		label: spec.label,
		config: [
			{
				type: 'row',
				fields: [spec.target(recip), recip('replyTo', keys.actionConfigReplyTo)],
			},
			...(fromAddresses || fromSources ? [buildFromField(fromAddresses, fromSources)] : []),
			{
				type: 'row',
				fields: [recip('cc', keys.actionConfigCc), recip('bcc', keys.actionConfigBcc)],
			},
			{
				name: 'subject',
				type: 'text',
				label: labelFor(keys.actionConfigSubject),
				...localizedIf(localize),
			},
			{
				name: 'body',
				type: 'richText',
				label: labelFor(keys.actionConfigBody),
				admin: { description: labelFor(keys.actionConfigBodyDescription) },
				...localizedIf(localize),
				...(editor ? { editor } : {}),
			},
		],
		run: async (args) => {
			const { config, values } = args
			const resolve = resolverFor(values)
			const sources = sourcesByValue(recipientSources)
			const sourceArgs: RecipientResolveArgs = {
				context: args.context,
				values,
				descriptors: args.descriptors,
				form: args.form,
				submissionId: args.submissionId,
				payload: args.payload,
				req: args.req,
				locale: args.locale,
			}
			const to = await spec.resolveTo({ config, resolve, sources, sourceArgs })
			if (!to) {
				// Nothing to send to. A target the author never configured is a misconfiguration (emailTeam
				// throws); a configured target that resolved empty (e.g. a source returned []) is a normal skip.
				if (!spec.hasTarget(config) && spec.onMissingTo === 'throw') {
					throw new Error(`${spec.type}: missing "to" address`)
				}
				return
			}
			if (typeof args.payload.sendEmail !== 'function') {
				throw new Error(`${spec.type}: no email adapter configured`)
			}

			const subject = interpolate(config.subject ?? '', resolve)
			const serialized = await args.renderBody(config.body)
			// Checked before `render`, which may wrap an empty body in a frame that has content of its own.
			if (!subject.trim() && !hasVisibleContent(serialized)) {
				throw new Error(`${spec.type}: empty subject and body`)
			}
			const html = render
				? await render({
						...sourceArgs,
						html: serialized,
						body: config.body,
						subject,
						actionType: spec.type,
					})
				: serialized
			const cc = (await resolveRecipientEntries(config.cc, { resolve, sources, sourceArgs })).join(
				', '
			)
			const bcc = (
				await resolveRecipientEntries(config.bcc, { resolve, sources, sourceArgs })
			).join(', ')
			const replyTo = (
				await resolveRecipientEntries(config.replyTo, { resolve, sources, sourceArgs })
			).join(', ')

			// A literal `from` was validated at save time against `fromAddresses(req)`; not re-checked
			// here (the job's `req` may differ from the authoring admin's, and the config is
			// admin-authored, not visitor-controlled), so it is forwarded verbatim. A stored source
			// value instead resolves freshly on every send, so the sender follows the host (e.g. a
			// tenant that changed its address) rather than freezing at authoring time.
			const from = await resolveSendFrom({
				configured: config.from,
				sources: fromSourcesByValue,
				sourceArgs,
			})
			await args.payload.sendEmail({
				to,
				subject,
				html,
				...(from ? { from } : {}),
				...(cc ? { cc } : {}),
				...(bcc ? { bcc } : {}),
				...(replyTo ? { replyTo } : {}),
			})
		},
	})
}
