import type { UIFieldServerProps } from 'payload'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import { keys } from '../translations/keys'
import { asFieldTranslate } from '../translations/server'
import type { SubmissionDescriptor, SubmissionValue } from './types'

const registry = buildRegistry(defaultFieldDefinitions)

type SubmissionDoc = {
	values?: SubmissionValue[]
	descriptors?: SubmissionDescriptor[]
	locale?: string
}

/**
 * Read-only, localized submission view (server component). Renders each answered field's snapshot
 * label next to its type-aware formatted value via the field type's `format`, using the request
 * locale and i18n, with no client bundle. Phase 1 formats the built-in field types; threading the
 * full resolved registry (custom types) to the view is a later phase.
 */
export const SubmissionAnswers = ({ data, req }: UIFieldServerProps) => {
	const doc = (data ?? {}) as SubmissionDoc
	const descriptors = doc.descriptors ?? []
	const values = doc.values ?? []
	const locale = doc.locale ?? req.locale ?? 'en'
	const t = asFieldTranslate(req.i18n.t)

	if (descriptors.length === 0) {
		return <p>{t(keys.submissionNoAnswers)}</p>
	}

	const valueByField = new Map(values.map((entry) => [entry.field, entry.value]))

	return (
		<div className="form-builder-submission-answers">
			<h4>{t(keys.submissionAnswers)}</h4>
			<dl>
				{descriptors.map((descriptor) => {
					const definition = registry.get(descriptor.fieldType)
					const raw = valueByField.get(descriptor.field)
					const formatted = definition?.format
						? definition.format({
								value: raw,
								config: {},
								optionLabels: descriptor.optionLabels,
								locale,
								t,
							})
						: raw == null
							? ''
							: String(raw)
					return (
						<div key={descriptor.field}>
							<dt>{descriptor.label}</dt>
							<dd>{formatted}</dd>
						</div>
					)
				})}
			</dl>
		</div>
	)
}
