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

/** A stored file answer's link, when the captured `FileRef` carries a url; null otherwise. */
const fileHref = (raw: unknown): { url: string; filename: string } | null => {
	if (raw && typeof raw === 'object' && 'url' in raw) {
		const ref = raw as { url?: unknown; filename?: unknown }
		if (typeof ref.url === 'string' && ref.url.length > 0) {
			return { url: ref.url, filename: typeof ref.filename === 'string' ? ref.filename : ref.url }
		}
	}
	return null
}

/**
 * Read-only, localized submission view (server component). Renders each answered field's snapshot
 * label next to its type-aware formatted value via the field type's `format`, using the request
 * locale and i18n, with no client bundle. The built-in field types are formatted directly; threading
 * the full resolved registry (custom types) to the view is a future enhancement.
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

					if (descriptor.fieldType === 'repeater') {
						const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
						const subFieldDescriptors = descriptor.subFieldDescriptors ?? []
						return (
							<div key={descriptor.field}>
								<dt>{descriptor.label}</dt>
								<dd>
									{rows.length === 0 ? (
										<span>—</span>
									) : (
										<ol className="form-builder-submission-answers__repeater">
											{rows.map((row, rowIndex) => {
												// biome-ignore lint/suspicious/noArrayIndexKey: submission rows have no stable ID; index is stable for read-only display
												const rowKey = rowIndex
												return (
													<li
														key={rowKey}
														className="form-builder-submission-answers__repeater-row"
													>
														<dl>
															{subFieldDescriptors.map((subDesc) => {
																const subDef = registry.get(subDesc.fieldType)
																const subRaw = row[subDesc.field]
																const subFormatted = subDef?.format
																	? subDef.format({
																			value: subRaw,
																			config: {},
																			optionLabels: subDesc.optionLabels,
																			locale,
																			t,
																		})
																	: subRaw == null
																		? ''
																		: String(subRaw)
																const subHref =
																	subDesc.fieldType === 'file' ? fileHref(subRaw) : null
																return (
																	<div key={subDesc.field}>
																		<dt>{subDesc.label}</dt>
																		<dd>
																			{subHref ? (
																				<a href={subHref.url} rel="noreferrer">
																					{subHref.filename}
																				</a>
																			) : (
																				subFormatted
																			)}
																		</dd>
																	</div>
																)
															})}
														</dl>
													</li>
												)
											})}
										</ol>
									)}
								</dd>
							</div>
						)
					}

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
					const href = descriptor.fieldType === 'file' ? fileHref(raw) : null
					return (
						<div key={descriptor.field}>
							<dt>{descriptor.label}</dt>
							<dd>
								{href ? (
									<a href={href.url} rel="noreferrer">
										{href.filename}
									</a>
								) : (
									formatted
								)}
							</dd>
						</div>
					)
				})}
			</dl>
		</div>
	)
}
