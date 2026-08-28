'use client'

import type { JobInputComponentProps } from '@10x-media/jobs/types'
import { TextInput, useField } from '@payloadcms/ui'
import type { ChangeEvent } from 'react'

/**
 * A one-field form over the `sleep` input. Its placeholder comes from
 * `input.examples` rather than the schema, so the form opens on 1500 rather
 * than on the derived 0.
 */
export const SleepInputForm = ({ path, placeholder, readOnly }: JobInputComponentProps) => {
	const { setValue, value } = useField<{ ms?: number } | null>({ path })

	return (
		<div style={{ display: 'grid', gap: 'calc(var(--base) / 2)' }}>
			<TextInput
				label="Sleep for (ms)"
				onChange={(event: ChangeEvent<HTMLInputElement>) =>
					setValue({ ms: Number(event.target.value) || 0 })
				}
				path={`${path}.ms`}
				readOnly={readOnly}
				value={String(value?.ms ?? '')}
			/>
			<small style={{ color: 'var(--theme-elevation-500)' }}>
				Placeholder from input.examples: <code>{JSON.stringify(placeholder)}</code>
			</small>
		</div>
	)
}
