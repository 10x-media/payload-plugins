import type { Field, RichTextField } from 'payload'
import type { DepartmentEmailsResolver } from '../../email/departments'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { type ActionDefinition, defineAction } from '../defineAction'
import { buildRecipientField, type RecipientsConfig, resolveRecipients } from '../emailRecipients'
import { buildFromField, type FromAddressesResolver } from '../fromAddresses'

/** The plugin-derived options every built-in email action is built from (was five positional args). */
export type EmailActionOptions = {
	localize: boolean
	editor?: RichTextField['editor']
	fromAddresses?: FromAddressesResolver
	departments?: DepartmentEmailsResolver
	recipients?: RecipientsConfig
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

/** What distinguishes one email action from another: identity, its primary target, and how it resolves/guards that target. */
type EmailActionSpec<TConfig extends EmailActionConfig> = {
	type: string
	label: string
	/** The first cell of the opening row (paired with `replyTo`): a recipient list, or an email-field select. */
	target: (recip: RecipientFieldBuilder) => Field
	/** Resolve the primary `to` from the stored config, or `undefined` when there is no recipient. */
	resolveTo: (config: TConfig, resolve: Resolver) => string | undefined
	/** With no resolved `to`, `emailTeam` treats it as a misconfiguration (`throw`), `confirmation` as a silent skip. */
	onMissingTo: 'throw' | 'skip'
}

/**
 * The shared skeleton of the built-in email actions (`emailTeam`, `confirmation`): an identical
 * config (a first row pairing the action's target with `replyTo`, an optional `from` select, a
 * cc/bcc row, a subject, and a rich text body, content and recipient fields carrying `localized`
 * when `localize`) and an identical send (interpolate the subject, render the body, resolve
 * cc/bcc/replyTo, and hand a single comma-joined string per list to `payload.sendEmail`). Only the
 * primary `to` target and its missing-value behavior differ, threaded through `spec`.
 */
export const buildEmailAction = <TConfig extends EmailActionConfig>(
	options: EmailActionOptions,
	spec: EmailActionSpec<TConfig>
): ActionDefinition<TConfig> => {
	const { localize, editor, fromAddresses, departments, recipients } = options
	const endpoint = departments ? 'departments' : undefined
	const recip: RecipientFieldBuilder = (name, labelKey) =>
		buildRecipientField(name, labelKey, localize, {
			endpoint,
			recipients,
			width: '50%',
			departments,
		})
	return defineAction<TConfig>({
		type: spec.type,
		label: spec.label,
		config: [
			{
				type: 'row',
				fields: [spec.target(recip), recip('replyTo', keys.actionConfigReplyTo)],
			},
			...(fromAddresses ? [buildFromField(fromAddresses)] : []),
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
		run: async ({ config, values, payload, renderBody }) => {
			const resolve = resolverFor(values)
			const to = spec.resolveTo(config, resolve)
			if (!to) {
				if (spec.onMissingTo === 'throw') {
					throw new Error(`${spec.type}: missing "to" address`)
				}
				return
			}
			if (typeof payload.sendEmail !== 'function') {
				throw new Error(`${spec.type}: no email adapter configured`)
			}

			const subject = interpolate(config.subject ?? '', resolve)
			const html = await renderBody(config.body)
			const cc = resolveRecipients(config.cc, resolve)
			const bcc = resolveRecipients(config.bcc, resolve)
			const replyTo = resolveRecipients(config.replyTo, resolve)

			// `from` was validated at save time against `fromAddresses(req)`; not re-checked here
			// (the job's `req` may differ from the authoring admin's, and the config is admin-authored,
			// not visitor-controlled), so the stored value is forwarded verbatim.
			await payload.sendEmail({
				to,
				subject,
				html,
				...(config.from ? { from: config.from } : {}),
				...(cc ? { cc } : {}),
				...(bcc ? { bcc } : {}),
				...(replyTo ? { replyTo } : {}),
			})
		},
	})
}
