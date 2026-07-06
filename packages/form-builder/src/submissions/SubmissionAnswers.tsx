import type { UIFieldServerProps } from 'payload'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import { keys } from '../translations/keys'
import { asFieldTranslate } from '../translations/server'
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

const fileHref = (raw: unknown): { url: string; filename: string } | null => {
	if (raw && typeof raw === 'object' && 'url' in raw) {
		const ref = raw as { url?: unknown; filename?: unknown }
		if (typeof ref.url === 'string' && ref.url.length > 0) {
			return {
				url: ref.url,
				filename: typeof ref.filename === 'string' ? ref.filename : ref.url,
			}
		}
	}
	return null
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

const sectionStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '0.125rem',
}

const headingStyle: React.CSSProperties = {
	fontSize: '0.6875rem',
	fontWeight: 600,
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: 'var(--theme-elevation-400)',
	margin: '0 0 0.25rem',
}

const rowStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '0.125rem',
	padding: '0.375rem 0',
	borderBottom: '1px solid var(--theme-elevation-100)',
}

const labelStyle: React.CSSProperties = {
	fontSize: '0.6875rem',
	fontWeight: 600,
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'var(--theme-elevation-400)',
	margin: 0,
}

const valueStyle: React.CSSProperties = {
	fontSize: 'inherit',
	color: 'var(--theme-text)',
	margin: 0,
	wordBreak: 'break-word',
}

const repeaterRowStyle: React.CSSProperties = {
	padding: '0.375rem 0.625rem',
	border: '1px solid var(--theme-elevation-150)',
	borderRadius: '3px',
	display: 'flex',
	flexDirection: 'column',
	gap: '0.25rem',
}

const pillStyle = (agreed: boolean): React.CSSProperties => ({
	display: 'inline-block',
	padding: '0.125rem 0.5rem',
	borderRadius: '9999px',
	fontSize: '0.75rem',
	fontWeight: 600,
	background: agreed ? 'var(--theme-success-500)' : 'var(--theme-error-500)',
	color: '#fff',
})

const SubField = ({
	descriptor,
	raw,
	locale,
	t,
}: {
	descriptor: SubmissionDescriptor
	raw: unknown
	locale: string
	t: ReturnType<typeof asFieldTranslate>
}) => {
	const def = registry.get(descriptor.fieldType)
	const formatted = def?.format
		? def.format({ value: raw, config: {}, optionLabels: descriptor.optionLabels, locale, t })
		: raw == null
			? ''
			: String(raw)
	const href = descriptor.fieldType === 'file' ? fileHref(raw) : null
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
			<p style={labelStyle}>{descriptor.label}</p>
			<p style={valueStyle}>
				{href ? (
					<a href={href.url} rel="noreferrer" style={{ color: 'var(--theme-text)' }}>
						{href.filename}
					</a>
				) : (
					formatted || '—'
				)}
			</p>
		</div>
	)
}

const AnswerRow = ({
	descriptor,
	raw,
	locale,
	t,
}: {
	descriptor: SubmissionDescriptor
	raw: unknown
	locale: string
	t: ReturnType<typeof asFieldTranslate>
}) => {
	if (descriptor.fieldType === 'repeater') {
		const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
		const subFieldDescriptors = descriptor.subFieldDescriptors ?? []
		return (
			<div style={rowStyle}>
				<p style={labelStyle}>{descriptor.label}</p>
				{rows.length === 0 ? (
					<p style={valueStyle}>—</p>
				) : (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '0.75rem',
							marginTop: '0.25rem',
						}}
					>
						{rows.map((row, rowIndex) => {
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable key
								<div key={rowIndex} style={repeaterRowStyle}>
									<p style={{ ...labelStyle, fontWeight: 600 }}>Row {rowIndex + 1}</p>
									{subFieldDescriptors.map((subDesc) => (
										<SubField
											key={subDesc.field}
											descriptor={subDesc}
											raw={row[subDesc.field]}
											locale={locale}
											t={t}
										/>
									))}
								</div>
							)
						})}
					</div>
				)}
			</div>
		)
	}

	const def = registry.get(descriptor.fieldType)
	const formatted = def?.format
		? def.format({ value: raw, config: {}, optionLabels: descriptor.optionLabels, locale, t })
		: raw == null
			? ''
			: String(raw)
	const href = descriptor.fieldType === 'file' ? fileHref(raw) : null

	return (
		<div style={rowStyle}>
			<p style={labelStyle}>{descriptor.label}</p>
			<p style={valueStyle}>
				{href ? (
					<a href={href.url} rel="noreferrer" style={{ color: 'var(--theme-text)' }}>
						{href.filename}
					</a>
				) : (
					formatted || '—'
				)}
			</p>
		</div>
	)
}

/**
 * Read-only submission view (server component). Renders field answers, consent proofs, and
 * submission metadata using Payload admin CSS variables so it tracks the admin theme automatically.
 */
export const SubmissionAnswers = ({ data, req }: UIFieldServerProps) => {
	const doc = (data ?? {}) as SubmissionDoc
	const descriptors = doc.descriptors ?? []
	const values = doc.values ?? []
	const locale = doc.locale ?? req.locale ?? 'en'
	const t = asFieldTranslate(req.i18n.t)
	const consentEntries = doc.consent ?? []
	const meta = doc.meta

	const hasAnswers = descriptors.length > 0
	const hasConsent = consentEntries.length > 0
	const hasMeta = meta != null && Object.keys(meta).length > 0

	if (!hasAnswers && !hasConsent && !hasMeta) {
		return (
			<p style={{ color: 'var(--theme-elevation-400)', fontSize: 'inherit' }}>
				{t(keys.submissionNoAnswers)}
			</p>
		)
	}

	const valueByField = new Map(values.map((entry) => [entry.field, entry.value]))

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: '1.25rem',
				padding: '0.25rem 0',
				fontFamily: 'var(--font-body, inherit)',
			}}
		>
			{hasAnswers && (
				<section style={sectionStyle}>
					<h3 style={headingStyle}>{t(keys.submissionAnswers)}</h3>
					{descriptors.map((descriptor) => (
						<AnswerRow
							key={descriptor.field}
							descriptor={descriptor}
							raw={valueByField.get(descriptor.field)}
							locale={locale}
							t={t}
						/>
					))}
				</section>
			)}

			{hasConsent && (
				<section style={sectionStyle}>
					<h3 style={headingStyle}>Consent</h3>
					{consentEntries.map((entry) => (
						<div key={entry.field} style={rowStyle}>
							<p style={labelStyle}>{entry.field}</p>
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: '0.25rem',
									marginTop: '0.125rem',
								}}
							>
								<span style={pillStyle(entry.agreed)}>{entry.agreed ? 'Agreed' : 'Declined'}</span>
								{entry.ref ? (
									<p style={valueStyle}>
										<a
											href={entry.ref}
											rel="noreferrer"
											target="_blank"
											style={{ color: 'var(--theme-text)' }}
										>
											{entry.ref}
										</a>
										{entry.versionRef ? ` (v${entry.versionRef})` : ''}
									</p>
								) : null}
								<p style={labelStyle}>{formatDate(entry.at, locale)}</p>
							</div>
						</div>
					))}
				</section>
			)}

			{hasMeta && (
				<section style={sectionStyle}>
					<h3 style={headingStyle}>Submission details</h3>
					{meta.at ? (
						<div style={rowStyle}>
							<p style={labelStyle}>Received at</p>
							<p style={valueStyle}>{formatDate(meta.at, locale)}</p>
						</div>
					) : null}
					{meta.ip ? (
						<div style={rowStyle}>
							<p style={labelStyle}>IP address</p>
							<p style={valueStyle}>{meta.ip}</p>
						</div>
					) : null}
					{meta.ua ? (
						<div style={rowStyle}>
							<p style={labelStyle}>User agent</p>
							<p style={{ ...valueStyle, color: 'var(--theme-elevation-500)' }}>
								{String(meta.ua)}
							</p>
						</div>
					) : null}
					{meta.spam ? (
						<div style={rowStyle}>
							<p style={labelStyle}>Spam check</p>
							<p style={valueStyle}>
								{'captcha' in (meta.spam as object)
									? `Captcha: ${String((meta.spam as MetaSpam).captcha)}`
									: '—'}
							</p>
						</div>
					) : null}
				</section>
			)}
		</div>
	)
}
