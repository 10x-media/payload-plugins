import type { UIFieldServerProps } from 'payload'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import { keys } from '../translations/keys'
import { asFieldTranslate } from '../translations/server'
import type {
	AnswerItem,
	ConsentItem,
	MetaItem,
	RepeaterItem,
	RepeaterRow,
} from './SubmissionAnswersClient'
import { SubmissionAnswersClient } from './SubmissionAnswersClient'
import type { SubmissionDescriptor, SubmissionValue } from './types'

const registry = buildRegistry(defaultFieldDefinitions)

type ConsentEntry = {
	field: string
	agreed: boolean
	ref?: string
	versionRef?: string
	at: string
}

type MetaSpam = { captcha?: string }

type SubmissionMeta = {
	at?: string
	ip?: string
	ua?: string
	spam?: MetaSpam
	[key: string]: unknown
}

type SubmissionDoc = {
	values?: SubmissionValue[]
	descriptors?: SubmissionDescriptor[]
	locale?: string
	consent?: ConsentEntry[]
	meta?: SubmissionMeta
}

const formatDate = (iso: string, locale: string): string => {
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(iso)
		)
	} catch {
		return iso
	}
}

/**
 * Server component. Formats submission data into serializable props and delegates
 * rendering to the client component which uses Payload's UI components.
 */
export const SubmissionAnswers = ({ data, req }: UIFieldServerProps) => {
	const doc = (data ?? {}) as SubmissionDoc
	const descriptors = doc.descriptors ?? []
	const values = doc.values ?? []
	const locale = doc.locale ?? req.locale ?? 'en'
	const t = asFieldTranslate(req.i18n.t)
	const rawConsent = doc.consent ?? []
	const meta = doc.meta

	const valueByField = new Map(values.map((entry) => [entry.field, entry.value]))

	const answers: AnswerItem[] = []
	const repeaters: RepeaterItem[] = []

	for (const descriptor of descriptors) {
		const raw = valueByField.get(descriptor.field)

		if (descriptor.fieldType === 'repeater') {
			const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
			const subDescs = descriptor.subFieldDescriptors ?? []
			repeaters.push({
				field: descriptor.field,
				label: descriptor.label,
				rows: rows.map((row, rowIndex) => ({
					id: String(rowIndex),
					subFields: subDescs.map((sub) => {
						const subDef = registry.get(sub.fieldType)
						const subRaw = row[sub.field]
						const formatted = subDef?.format
							? subDef.format({
									value: subRaw,
									config: {},
									optionLabels: sub.optionLabels,
									locale,
									t,
								})
							: subRaw == null
								? ''
								: String(subRaw)
						return { label: sub.label, value: formatted || '—' }
					}),
				})),
			})
			continue
		}

		const def = registry.get(descriptor.fieldType)
		const formatted = def?.format
			? def.format({ value: raw, config: {}, optionLabels: descriptor.optionLabels, locale, t })
			: raw == null
				? ''
				: String(raw)

		if (descriptor.fieldType === 'file') {
			const ref =
				raw && typeof raw === 'object' && 'url' in raw
					? (raw as { url?: string; filename?: string })
					: null
			const url = typeof ref?.url === 'string' ? ref.url : undefined
			const filename = typeof ref?.filename === 'string' ? ref.filename : (url ?? '')
			answers.push({ field: descriptor.field, label: descriptor.label, value: filename, href: url })
		} else {
			answers.push({
				field: descriptor.field,
				label: descriptor.label,
				value: formatted || '—',
				multiline: descriptor.fieldType === 'textarea',
			})
		}
	}

	const consent: ConsentItem[] = rawConsent.map((entry) => ({
		...entry,
		at: formatDate(entry.at, locale),
	}))

	const metaItems: MetaItem[] = []
	if (meta) {
		if (meta.at) metaItems.push({ label: 'Received at', value: formatDate(meta.at, locale) })
		if (meta.ip) metaItems.push({ label: 'IP address', value: meta.ip })
		if (meta.ua) metaItems.push({ label: 'User agent', value: String(meta.ua) })
		if (meta.spam) {
			const captcha =
				typeof meta.spam === 'object' && 'captcha' in meta.spam
					? String((meta.spam as MetaSpam).captcha)
					: '—'
			metaItems.push({ label: 'Captcha', value: captcha })
		}
	}

	return (
		<SubmissionAnswersClient
			answers={answers}
			repeaters={repeaters}
			consent={consent}
			meta={metaItems}
			emptyLabel={t(keys.submissionNoAnswers)}
		/>
	)
}
