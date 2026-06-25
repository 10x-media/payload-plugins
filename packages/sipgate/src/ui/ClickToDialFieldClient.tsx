'use client'

import {
	Button,
	Drawer,
	DrawerToggler,
	FieldLabel,
	TextInput,
	useField,
	useModal,
} from '@payloadcms/ui'
import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'

type SipgateDevice = {
	id: string
	alias: string
	type: string
	online: boolean
	registered: { userAgent: string }[]
}

type Props = {
	path: string
	label?: string
	placeholder?: string
	required?: boolean
	readOnly?: boolean
	width?: string | number | undefined
}

const DRAWER_SLUG = 'sipgate-device-picker'

export const ClickToDialFieldClient = ({
	path,
	label,
	placeholder,
	required,
	readOnly,
	width,
}: Props) => {
	const { value, setValue, showError } = useField<string>({ path })
	const [dialState, setDialState] = useState<'idle' | 'dialing' | 'success' | 'error'>('idle')
	const [devices, setDevices] = useState<SipgateDevice[]>([])
	const { closeModal } = useModal()

	// states
	const [isLoading, setIsLoading] = useState(false)

	useEffect(() => {
		setIsLoading(true)
		fetch('/api/sipgate/devices')
			.then((r) => r.json())
			.then(setDevices)
			.catch(() => {})
			.finally(() => setIsLoading(false))
	}, [])

	const dial = async (deviceId: string) => {
		if (!value) return
		closeModal(DRAWER_SLUG)
		setDialState('dialing')
		try {
			const res = await fetch('/api/sipgate/dial', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callee: value, deviceId }),
			})
			if (!res.ok) throw new Error()
			setDialState('success')
		} catch {
			setDialState('error')
		} finally {
			setTimeout(() => setDialState('idle'), 3000)
		}
	}

	return (
		<div className="field-type text" style={width ? { width } : undefined}>
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
				<DrawerToggler
					slug={DRAWER_SLUG}
					disabled={!value || readOnly || dialState === 'dialing'}
					className={`btn btn--size-medium btn--style-${dialState === 'error' ? 'error' : 'primary'}`}
					style={{ margin: 0 }}
				>
					{dialState === 'idle'
						? 'Dial'
						: dialState === 'dialing'
							? 'Dialing...'
							: dialState === 'success'
								? 'Called!'
								: 'Failed'}
				</DrawerToggler>
			</div>

			<Drawer slug={DRAWER_SLUG} title={`Call ${value}`}>
				<div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
					{isLoading ? <p>Loading devices...</p> : null}
					{!isLoading && devices.length === 0 && <p>No devices found.</p>}
					{!isLoading &&
						devices.length > 0 &&
						devices.map((device) => (
							<Button
								key={device.id}
								type="button"
								margin={false}
								buttonStyle="secondary"
								onClick={() => dial(device.id)}
							>
								<span
									style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
								>
									<strong>{device.alias}</strong>
									<small style={{ opacity: 0.6 }}>
										{device.online ? '● Online' : '○ Offline'} · {device.id}
										{device.registered[0] ? ` · ${device.registered[0].userAgent}` : ''}
									</small>
								</span>
							</Button>
						))}
				</div>
			</Drawer>
		</div>
	)
}
