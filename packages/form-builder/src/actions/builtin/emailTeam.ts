import type { RichTextField } from 'payload'
import type { DepartmentEmailsResolver } from '../../email/departments'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'
import { buildRecipientField, type RecipientsConfig, resolveRecipients } from '../emailRecipients'
import { buildFromField, type FromAddressesResolver } from '../fromAddresses'

type EmailTeamConfig = {
	to?: string[]
	from?: string
	cc?: string[]
	bcc?: string[]
	replyTo?: string[]
	subject?: string
	body?: unknown
}

/**
 * `to`, `replyTo`, `cc`, and `bcc` are recipient lists (`RecipientsSelect`, stored as `string[]`):
 * each entry is a literal email, a picked department address (when `departments` is set its options
 * back the select), or a `{{field}}` token resolved from the submission at send. `from` is a single
 * address that never localizes, added only when `fromAddresses` is set. `subject` and `body` are email
 * content; `editor` overrides the body's richText editor. `recipients` narrows the recipient fields'
 * behavior (free-typed emails, field tokens). Content and recipient fields carry `localized: true`
 * when `localize` is true. At send, every recipient list is interpolated, empties dropped, and joined
 * into the comma-separated string `payload.sendEmail` (nodemailer) accepts.
 */
// biome-ignore lint/complexity/useMaxParams: positional args thread plugin options (localize, editor, fromAddresses, departments, recipients)
export const buildEmailTeam = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver,
	departments?: DepartmentEmailsResolver,
	recipients?: RecipientsConfig
) => {
	const endpoint = departments ? 'departments' : undefined
	const recip = (name: string, labelKey: string) =>
		buildRecipientField(name, labelKey, localize, { endpoint, recipients, width: '50%' })
	return defineAction<EmailTeamConfig>({
		type: 'emailTeam',
		label: keys.actionEmailTeam,
		config: [
			{
				type: 'row',
				fields: [recip('to', keys.actionConfigTo), recip('replyTo', keys.actionConfigReplyTo)],
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
		run: async (args) => {
			const { config, values, payload, renderBody } = args

			const resolve = resolverFor(values)
			const to = resolveRecipients(config.to, resolve)
			if (!to) {
				throw new Error('emailTeam: missing "to" address')
			}
			if (typeof payload.sendEmail !== 'function') {
				throw new Error('emailTeam: no email adapter configured')
			}

			const subject = interpolate(config.subject ?? '', resolve)
			const html = await renderBody(config.body)
			const cc = resolveRecipients(config.cc, resolve)
			const bcc = resolveRecipients(config.bcc, resolve)
			const replyTo = resolveRecipients(config.replyTo, resolve)

			// `from` was validated at save time against `fromAddresses(req)`; not re-checked here
			// (the job's `req` may differ from the authoring admin's, and the config is
			// admin-authored, not visitor-controlled), so the stored value is forwarded verbatim.
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

export const emailTeam = buildEmailTeam(true)
