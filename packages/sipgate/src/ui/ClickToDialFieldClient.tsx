'use client'

import { Button, FieldLabel, TextInput, useField } from '@payloadcms/ui'
import type { ChangeEvent } from 'react'
import { useState } from 'react'

type Props = {
	path: string
	label?: string
	placeholder?: string
	required?: boolean
	readOnly?: boolean
}

export const ClickToDialFieldClient = ({ path, label, placeholder, required, readOnly }: Props) => {
	const { value, setValue, showError } = useField<string>({ path })
	const [dialState, setDialState] = useState<'idle' | 'dialing' | 'success' | 'error'>('idle')

	const handleDial = async () => {
		if (!value) return
		setDialState('dialing')
		try {
			const res = await fetch('/api/sipgate/dial', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callee: value }),
			})
			if (!res.ok) throw new Error('Failed to initiate call')
			setDialState('success')
			setTimeout(() => setDialState('idle'), 3000)
		} catch {
			setDialState('error')
			setTimeout(() => setDialState('idle'), 3000)
		}
	}

	const dialLabel = {
		idle: 'Dial',
		dialing: 'Dialing...',
		success: 'Called!',
		error: 'Failed',
	}[dialState]

	return (
		<div className="field-type text">
			<FieldLabel label={label} path={path} required={required} />
			<div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
				<TextInput
					path={path}
					value={value ?? ''}
					onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
					readOnly={readOnly}
					showError={showError}
					placeholder={placeholder}
					required={required}
					style={{ flex: 1, margin: 0 }}
				/>
				<Button
					type="button"
					buttonStyle={dialState === 'error' ? 'error' : 'primary'}
					size="medium"
					disabled={!value || readOnly || dialState === 'dialing'}
					onClick={handleDial}
					tooltip={dialState === 'idle' ? `Call ${value}` : undefined}
					margin={false}
				>
					{dialLabel}
				</Button>
			</div>
		</div>
	)
}
