import type { RichTextField, TextField } from 'payload'
import type { DepartmentEmailsResolver } from '../../email/departments'
import { buildToField } from '../../email/departments'
import { localizedIf } from '../../fields/localizedIf'
import { interpolate } from '../../recall/interpolate'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { resolverFor } from '../body/serializeBody'
import { defineAction } from '../defineAction'
import { buildFromField, type FromAddressesResolver } from '../fromAddresses'

type EmailTeamConfig = {
	to?: string
	from?: string
	cc?: string
	bcc?: string
	replyTo?: string
	subject?: string
	body?: unknown
}

/**
 * `subject` and `body` are email content and follow `localize`; `from` is an address that never
 * does. `to` is localized (following `localize`): a submission's locale selects the stored `to` at
 * send, so a German submission routes to the German address. `cc`, `bcc`, and `replyTo` follow the
 * same localized-address posture as `to`, each interpolated the same as `subject` so `{{field}}`
 * merge tags work; a comma-separated list is forwarded as-is, since `payload.sendEmail`
 * (nodemailer) accepts one directly. `editor` overrides the body field's Lexical/richText editor
 * (from the plugin's `richText.editor` option). `fromAddresses`, when given (the plugin's
 * `email.fromAddresses` option), adds a `from` select sourced from the host resolver; absent, no
 * `from` field exists and every send uses the email adapter's default sender. `departments`, when
 * given (the plugin's `email.departments` option), turns `to` into a select whose options are the
 * host's resolved departments; absent, `to` stays a plain (localized) text field.
 */
// biome-ignore lint/complexity/useMaxParams: positional args mirror the fromAddresses threading (localize, editor, fromAddresses, departments)
export const buildEmailTeam = (
	localize: boolean,
	editor?: RichTextField['editor'],
	fromAddresses?: FromAddressesResolver,
	departments?: DepartmentEmailsResolver
) => {
	const toField: TextField = departments
		? buildToField(departments, localize)
		: { name: 'to', type: 'text', label: labelFor(keys.actionConfigTo), ...localizedIf(localize) }
	return defineAction<EmailTeamConfig>({
		type: 'emailTeam',
		label: keys.actionEmailTeam,
		config: [
			toField,
			...(fromAddresses ? [buildFromField(fromAddresses)] : []),
			{
				name: 'cc',
				type: 'text',
				label: labelFor(keys.actionConfigCc),
				...localizedIf(localize),
			},
			{
				name: 'bcc',
				type: 'text',
				label: labelFor(keys.actionConfigBcc),
				...localizedIf(localize),
			},
			{
				name: 'replyTo',
				type: 'text',
				label: labelFor(keys.actionConfigReplyTo),
				...localizedIf(localize),
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

			if (!config.to) {
				throw new Error('emailTeam: missing "to" address')
			}

			if (typeof payload.sendEmail !== 'function') {
				throw new Error('emailTeam: no email adapter configured')
			}

			const resolve = resolverFor(values)
			const subject = interpolate(config.subject ?? '', resolve)
			const html = await renderBody(config.body)

			// `from` was validated at save time against `fromAddresses(req)`; not re-checked here
			// (the job's `req` may differ from the authoring admin's, and the config is
			// admin-authored, not visitor-controlled), so the stored value is forwarded verbatim.
			await payload.sendEmail({
				to: config.to,
				subject,
				html,
				...(config.from ? { from: config.from } : {}),
				...(config.cc ? { cc: interpolate(config.cc, resolve) } : {}),
				...(config.bcc ? { bcc: interpolate(config.bcc, resolve) } : {}),
				...(config.replyTo ? { replyTo: interpolate(config.replyTo, resolve) } : {}),
			})
		},
	})
}

export const emailTeam = buildEmailTeam(true)
