'use client'

import type { JobInputComponentProps } from '@10x-media/jobs/types'
import { CheckboxInput, SelectInput, TextInput, useField } from '@payloadcms/ui'
import type { ChangeEvent } from 'react'

type Input = {
	athleteCodes?: string[]
	disciplines?: string[]
	dryRun?: boolean
	limit?: number
}

const DISCIPLINES = [
	{ label: 'Canoe sprint', value: 'sprint' },
	{ label: 'Canoe slalom', value: 'slalom' },
]

/**
 * A form over the `importAthletes` input, built from Payload's own inputs. It
 * owns no state: every control reads the job's `input` through `useField` and
 * writes a patched copy back, so the pre-filled placeholder shows up here and
 * whatever the editor changes is what the job receives.
 */
export const ImportAthletesInput = ({ path, placeholder, readOnly }: JobInputComponentProps) => {
	const { setValue, value } = useField<Input | null>({ path })
	const input = value ?? {}
	const patch = (part: Partial<Input>) => setValue({ ...input, ...part })

	return (
		<div style={{ display: 'grid', gap: 'var(--base)' }}>
			<SelectInput
				hasMany
				label="Disciplines"
				name="disciplines"
				onChange={(selected) => {
					const options = Array.isArray(selected) ? selected : selected ? [selected] : []
					patch({ disciplines: options.map((option) => String(option.value)) })
				}}
				options={DISCIPLINES}
				path={`${path}.disciplines`}
				readOnly={readOnly}
				value={input.disciplines ?? []}
			/>
			<TextInput
				label="Athlete codes, comma separated"
				onChange={(event: ChangeEvent<HTMLInputElement>) =>
					patch({
						athleteCodes: event.target.value
							.split(',')
							.map((code) => code.trim())
							.filter(Boolean),
					})
				}
				path={`${path}.athleteCodes`}
				readOnly={readOnly}
				value={(input.athleteCodes ?? []).join(', ')}
			/>
			<TextInput
				label="Limit"
				onChange={(event: ChangeEvent<HTMLInputElement>) =>
					patch({ limit: event.target.value === '' ? undefined : Number(event.target.value) })
				}
				path={`${path}.limit`}
				readOnly={readOnly}
				value={String(input.limit ?? '')}
			/>
			<CheckboxInput
				checked={Boolean(input.dryRun)}
				id={`${path}-dryRun`}
				label="Dry run"
				onToggle={() => patch({ dryRun: !input.dryRun })}
				readOnly={readOnly}
			/>
			<small style={{ color: 'var(--theme-elevation-500)' }}>
				Placeholder derived from inputSchema: <code>{JSON.stringify(placeholder)}</code>
			</small>
		</div>
	)
}
