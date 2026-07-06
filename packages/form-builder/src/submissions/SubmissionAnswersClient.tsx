'use client'

import { FieldLabel } from '@payloadcms/ui'

export type AnswerItem = {
	field: string
	label: string
	value: string
	href?: string
	multiline?: boolean
}

export type RepeaterRow = {
	id: string
	subFields: Array<{ label: string; value: string }>
}

export type RepeaterItem = {
	field: string
	label: string
	rows: RepeaterRow[]
}

export type ConsentItem = {
	field: string
	agreed: boolean
	ref?: string
	versionRef?: string
	at: string
}

export type MetaItem = {
	label: string
	value: string
	muted?: boolean
}

type Props = {
	answers: AnswerItem[]
	repeaters: RepeaterItem[]
	consent: ConsentItem[]
	meta: MetaItem[]
	emptyLabel: string
}

const inputStyle: React.CSSProperties = {
	width: '100%',
	background: 'var(--theme-input-bg, var(--theme-elevation-50))',
	border: '1px solid var(--theme-elevation-200)',
	borderRadius: '4px',
	padding: '8px 12px',
	fontFamily: 'inherit',
	fontSize: 'inherit',
	color: 'var(--theme-text)',
	cursor: 'default',
	opacity: 0.8,
	boxSizing: 'border-box',
}

const fieldWrap: React.CSSProperties = { paddingBottom: '12px' }

const sectionHeading: React.CSSProperties = {
	fontSize: '0.75rem',
	fontWeight: 600,
	color: 'var(--theme-elevation-500)',
	margin: '16px 0 8px',
	paddingBottom: '4px',
	borderBottom: '1px solid var(--theme-elevation-100)',
}

const pillStyle = (agreed: boolean): React.CSSProperties => ({
	display: 'inline-block',
	padding: '2px 8px',
	borderRadius: '9999px',
	fontSize: '0.75rem',
	fontWeight: 600,
	background: agreed ? 'var(--theme-success-500)' : 'var(--theme-error-500)',
	color: '#fff',
	marginBottom: '4px',
})

const ReadOnlyInput = ({ value, multiline }: { value: string; multiline?: boolean }) =>
	multiline ? (
		<textarea readOnly value={value} rows={3} style={inputStyle} />
	) : (
		<input type="text" readOnly value={value} style={inputStyle} />
	)

export const SubmissionAnswersClient = ({
	answers,
	repeaters,
	consent,
	meta,
	emptyLabel,
}: Props) => {
	const hasContent =
		answers.length > 0 || repeaters.length > 0 || consent.length > 0 || meta.length > 0

	if (!hasContent) {
		return <p style={{ color: 'var(--theme-elevation-500)', fontSize: 'inherit' }}>{emptyLabel}</p>
	}

	return (
		<div>
			{(answers.length > 0 || repeaters.length > 0) && (
				<section>
					{answers.map(({ field, label, value, href, multiline }) => (
						<div key={field} style={fieldWrap}>
							<FieldLabel label={label} />
							{href ? (
								<a
									href={href}
									target="_blank"
									rel="noreferrer"
									style={{
										display: 'block',
										padding: '8px 0',
										color: 'var(--theme-text)',
										textDecoration: 'underline',
									}}
								>
									{value}
								</a>
							) : (
								<ReadOnlyInput value={value} multiline={multiline} />
							)}
						</div>
					))}

					{repeaters.map(({ field, label, rows }) => (
						<div key={field} style={fieldWrap}>
							<FieldLabel label={label} />
							{rows.length === 0 ? (
								<input type="text" readOnly value="—" style={inputStyle} />
							) : (
								<div
									style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}
								>
									{rows.map((row) => (
										<div
											key={row.id}
											style={{
												border: '1px solid var(--theme-elevation-150)',
												borderRadius: '4px',
												padding: '8px 12px',
											}}
										>
											<p
												style={{
													fontSize: '0.75rem',
													fontWeight: 600,
													color: 'var(--theme-elevation-500)',
													margin: '0 0 8px',
												}}
											>
												Row {Number(row.id) + 1}
											</p>
											{row.subFields.map((subField) => (
												<div key={subField.label} style={{ paddingBottom: '8px' }}>
													<FieldLabel label={subField.label} />
													<ReadOnlyInput value={subField.value} />
												</div>
											))}
										</div>
									))}
								</div>
							)}
						</div>
					))}
				</section>
			)}

			{consent.length > 0 && (
				<section>
					<p style={sectionHeading}>Consent</p>
					{consent.map((entry) => (
						<div key={entry.field} style={fieldWrap}>
							<FieldLabel label={entry.field} />
							<div
								style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}
							>
								<span style={pillStyle(entry.agreed)}>{entry.agreed ? 'Agreed' : 'Declined'}</span>
								{entry.ref ? (
									<a
										href={entry.ref}
										target="_blank"
										rel="noreferrer"
										style={{ fontSize: '0.8rem', color: 'var(--theme-text)' }}
									>
										{entry.ref}
										{entry.versionRef ? ` (v${entry.versionRef})` : ''}
									</a>
								) : null}
								<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-500)' }}>
									{entry.at}
								</span>
							</div>
						</div>
					))}
				</section>
			)}

			{meta.length > 0 && (
				<section>
					<p style={sectionHeading}>Submission details</p>
					{meta.map((item) => (
						<div key={item.label} style={fieldWrap}>
							<FieldLabel label={item.label} />
							<input
								type="text"
								readOnly
								value={item.value}
								style={{ ...inputStyle, ...(item.muted ? { opacity: 0.5 } : {}) }}
							/>
						</div>
					))}
				</section>
			)}
		</div>
	)
}
