'use client'

import { FieldLabel, Pill, TextInput } from '@payloadcms/ui'
import type { ChangeEvent } from 'react'
import type { SubmissionWidth } from './types'

export type AnswerItem = {
	field: string
	label: string
	value: string
	href?: string
	multiline?: boolean
	width?: SubmissionWidth
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
	/** The consent source's name at submit time (see `ConsentProof.name`). */
	name?: string
	/** The plain-text snapshot of the wording agreed to (see `ConsentProof.statementText`). */
	statementText?: string
	versionRef?: string
	at: string
}

export type MetaItem = {
	label: string
	value: string
}

export type SubmissionAnswersLabels = {
	answers: string
	consent: string
	submissionDetails: string
	agreed: string
	declined: string
	/** Row heading template containing `{n}`, the 1-based row number. */
	row: string
	empty: string
}

type Props = {
	answers: AnswerItem[]
	repeaters: RepeaterItem[]
	consent: ConsentItem[]
	meta: MetaItem[]
	labels: SubmissionAnswersLabels
}

const noop = (_e: ChangeEvent<HTMLInputElement>) => {}

/** Horizontal gutter between fields sharing a row; also trimmed from each fractional basis so widths wrap cleanly rather than overflow. */
const FIELD_GAP = 'calc(var(--base, 20px) / 2)'

const BASIS: Record<SubmissionWidth, string> = {
	full: '100%',
	half: '50%',
	third: '33.333%',
	twoThirds: '66.666%',
}

/**
 * Flex sizing for one answer field. Full fields (and file links / repeaters) claim a whole row;
 * fractional ones sit side by side, their basis trimmed by the gutter and floored by `min-width`
 * so a half or third never collapses on a narrow admin panel (it wraps to its own row instead).
 */
const widthStyle = (width?: SubmissionWidth): React.CSSProperties => {
	const basis = BASIS[width ?? 'full']
	return basis === '100%'
		? { flex: '1 1 100%' }
		: { flex: `0 1 calc(${basis} - ${FIELD_GAP})`, minWidth: 'min(100%, 12rem)' }
}

const answersGrid: React.CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	columnGap: FIELD_GAP,
}

const fullWidth: React.CSSProperties = { flex: '1 1 100%' }

const rowHeading: React.CSSProperties = {
	fontSize: '0.75rem',
	fontWeight: 600,
	color: 'var(--theme-elevation-500)',
	margin: '0 0 4px',
}

const linkStyle: React.CSSProperties = {
	display: 'block',
	padding: '8px 0',
	color: 'var(--theme-text)',
	textDecoration: 'underline',
}

export const SubmissionAnswersClient = ({ answers, repeaters, consent, meta, labels }: Props) => {
	const hasContent =
		answers.length > 0 || repeaters.length > 0 || consent.length > 0 || meta.length > 0

	if (!hasContent) {
		return <p style={{ color: 'var(--theme-elevation-500)' }}>{labels.empty}</p>
	}

	return (
		<div className="field-type" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
			{(answers.length > 0 || repeaters.length > 0) && (
				<section>
					<FieldLabel label={labels.answers} />
					<div className="render-fields" style={answersGrid}>
						{answers.map(({ field, label, value, href, width }) =>
							href ? (
								<div key={field} className="field-type" style={fullWidth}>
									<FieldLabel label={label} />
									<a href={href} target="_blank" rel="noreferrer" style={linkStyle}>
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
									style={widthStyle(width)}
								/>
							)
						)}

						{repeaters.map(({ field, label, rows }) => (
							<div key={field} className="field-type" style={fullWidth}>
								<FieldLabel label={label} />
								{rows.length === 0 ? (
									<TextInput
										path={`sa-${field}-empty`}
										label=""
										value="—"
										readOnly
										onChange={noop}
									/>
								) : (
									<div
										style={{
											display: 'flex',
											flexDirection: 'column',
											gap: '8px',
											marginTop: '4px',
										}}
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
												<p style={rowHeading}>
													{labels.row.replace('{n}', String(Number(row.id) + 1))}
												</p>
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
					</div>
				</section>
			)}

			{consent.length > 0 && (
				<section>
					<FieldLabel label={labels.consent} />
					<div className="render-fields">
						{consent.map((entry) => (
							<div key={entry.field} className="field-type">
								<FieldLabel label={entry.field} />
								<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
									<div
										style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
									>
										<Pill pillStyle={entry.agreed ? 'success' : 'error'} size="small" rounded>
											{entry.agreed ? labels.agreed : labels.declined}
										</Pill>
										{entry.name ? (
											<span style={{ fontSize: '0.8rem', color: 'var(--theme-text)' }}>
												{entry.name}
												{entry.versionRef ? ` (v${entry.versionRef})` : ''}
											</span>
										) : null}
									</div>
									{entry.statementText ? (
										<span style={{ fontSize: '0.8rem', color: 'var(--theme-elevation-600)' }}>
											{entry.statementText}
										</span>
									) : null}
									<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-500)' }}>
										{entry.at}
									</span>
								</div>
							</div>
						))}
					</div>
				</section>
			)}

			{meta.length > 0 && (
				<section>
					<FieldLabel label={labels.submissionDetails} />
					<div className="render-fields">
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
					</div>
				</section>
			)}
		</div>
	)
}
