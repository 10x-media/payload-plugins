'use client'

import { FieldLabel, TextInput } from '@payloadcms/ui'
import type { ChangeEvent } from 'react'

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
}

type Props = {
	answers: AnswerItem[]
	repeaters: RepeaterItem[]
	consent: ConsentItem[]
	meta: MetaItem[]
	emptyLabel: string
}

const noop = (_e: ChangeEvent<HTMLInputElement>) => {}

const pillStyle = (agreed: boolean): React.CSSProperties => ({
	display: 'inline-block',
	padding: '2px 8px',
	borderRadius: '9999px',
	fontSize: '0.75rem',
	fontWeight: 600,
	background: agreed ? 'var(--theme-success-500)' : 'var(--theme-error-500)',
	color: '#fff',
})

const rowHeading: React.CSSProperties = {
	fontSize: '0.75rem',
	fontWeight: 600,
	color: 'var(--theme-elevation-500)',
	margin: '0 0 4px',
}

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
		return <p style={{ color: 'var(--theme-elevation-500)' }}>{emptyLabel}</p>
	}

	return (
		<div className="field-type" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
			{(answers.length > 0 || repeaters.length > 0) && (
				<section>
					{answers.map(({ field, label, value, href }) =>
						href ? (
							<div key={field} className="field-type">
								<FieldLabel label={label} />
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
							</div>
						) : (
							<TextInput
								key={field}
								path={`sa-${field}`}
								label={label}
								value={value}
								readOnly
								onChange={noop}
							/>
						)
					)}

					{repeaters.map(({ field, label, rows }) => (
						<div key={field} className="field-type">
							<FieldLabel label={label} />
							{rows.length === 0 ? (
								<TextInput path={`sa-${field}-empty`} label="" value="—" readOnly onChange={noop} />
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
												padding: '4px 12px 0',
											}}
										>
											<p style={rowHeading}>Row {Number(row.id) + 1}</p>
											{row.subFields.map((subField) => (
												<TextInput
													key={subField.label}
													path={`sa-${field}-${row.id}-${subField.label}`}
													label={subField.label}
													value={subField.value}
													readOnly
													onChange={noop}
												/>
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
					{consent.map((entry) => (
						<div key={entry.field} className="field-type">
							<FieldLabel label={entry.field} />
							<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
					{meta.map((item) => (
						<TextInput
							key={item.label}
							path={`sa-meta-${item.label}`}
							label={item.label}
							value={item.value}
							readOnly
							onChange={noop}
						/>
					))}
				</section>
			)}
		</div>
	)
}
