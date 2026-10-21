'use client'
import { ColorInput, MeasurementInput } from '@10x-media/fields/client'
import { TextInput } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'

// Form-free inputs rendered from a `ui` field: their values live in local state, so
// nothing here reaches the document. The readout proves what each onChange delivers.

const readout: React.CSSProperties = {
	color: 'var(--theme-elevation-500)',
	fontFamily: 'var(--font-mono)',
	fontSize: '0.8rem',
	marginBottom: 'var(--spacing-field)',
}

const brandPresets = [
	{ key: 'brand', label: 'Brand', value: '#0055ff' },
	{ key: 'accent', label: 'Accent', value: '#ff6600' },
]

const Readout: React.FC<{ value: unknown }> = ({ value }) => (
	<div style={readout}>onChange: {JSON.stringify(value ?? null)}</div>
)

export const ColorInputShowcase: React.FC = () => {
	const [text, setText] = useState('')
	const [plain, setPlain] = useState<null | string>('#3366ff')
	const [linked, setLinked] = useState<null | string>('preset:brand')
	return (
		<div>
			<TextInput
				label="Native TextInput (standalone, for comparison)"
				onChange={(event: React.ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
				path="standaloneNativeText"
				value={text}
			/>
			<Readout value={text} />
			<ColorInput
				description="ColorInput with default options: no form, no server wrapper"
				label="Standalone ColorInput"
				onChange={setPlain}
				value={plain}
			/>
			<Readout value={plain} />
			<ColorInput
				description="Linked references against presets passed in as props, stored as rgb"
				label="Standalone ColorInput, linked presets"
				onChange={setLinked}
				options={{ format: 'rgb', linked: true }}
				presets={brandPresets}
				value={linked}
			/>
			<Readout value={linked} />
		</div>
	)
}

export const MeasurementInputShowcase: React.FC = () => {
	const [height, setHeight] = useState<null | number>(180)
	const [load, setLoad] = useState<null | number>(null)
	return (
		<div>
			<MeasurementInput
				description="Stored in cm, at least 50 cm; the unit menu shares the height preference bucket"
				label="Standalone MeasurementInput"
				min={50}
				onChange={setHeight}
				options={{ preferenceKey: 'height', storageUnit: 'cm', units: ['cm', 'm', 'in', 'ft-in'] }}
				value={height}
			/>
			<Readout value={height} />
			<MeasurementInput
				description="Only storageUnit given: units and preference bucket default from it"
				label="Standalone MeasurementInput, defaults"
				onChange={setLoad}
				options={{ storageUnit: 'kg' }}
				value={load}
			/>
			<Readout value={load} />
		</div>
	)
}
