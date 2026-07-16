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
import { useState } from 'react'
import { resolveInitialChannel } from '../utils/resolveInitialChannel'

type SipgateDevice = {
	id: string
	alias: string
	type: string
	online: boolean
	dnd: boolean
}

type SipgateChannel = {
	id: string
	name: string
}

type Props = {
	path: string
	label?: string
	placeholder?: string
	required?: boolean
	readOnly?: boolean
	width?: string | number | undefined
	initialDevices?: SipgateDevice[]
	initialChannels?: SipgateChannel[]
	defaultChannelId?: string
}

const DRAWER_SLUG = 'sipgate-device-picker'

export const ClickToDialFieldClient = ({
	path,
	label,
	placeholder,
	required,
	readOnly,
	width,
	initialDevices,
	initialChannels,
	defaultChannelId,
}: Props) => {
	const { value, setValue, showError } = useField<string>({ path })
	const [dialState, setDialState] = useState<'idle' | 'dialing' | 'success' | 'error'>('idle')
	const [devices] = useState<SipgateDevice[]>(initialDevices ?? [])
	const [channels] = useState<SipgateChannel[]>(initialChannels ?? [])
	const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(
		resolveInitialChannel(initialChannels, defaultChannelId)
	)
	const { closeModal } = useModal()

	const dial = async (deviceId: string) => {
		if (!value) return
		closeModal(DRAWER_SLUG)
		setDialState('dialing')
		try {
			const res = await fetch('/api/sipgate/dial', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callee: value, deviceId, channelId: selectedChannelId }),
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
			<div style={{ display: 'flex', gap: 'calc(var(--base) * 0.5)', alignItems: 'stretch' }}>
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
				<div
					style={{
						padding: 'var(--base)',
						display: 'flex',
						flexDirection: 'column',
						gap: 'var(--base)',
					}}
				>
					{channels.length > 1 && (
						<div>
							<p style={{ marginBottom: 'calc(var(--base) * 0.5)', fontWeight: 600 }}>Call from</p>
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 'calc(var(--base) * 0.25)',
								}}
							>
								{channels.map((channel) => (
									<label
										key={channel.id}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 'calc(var(--base) * 0.5)',
											cursor: 'pointer',
										}}
									>
										<input
											type="radio"
											name="sipgate-channel"
											value={channel.id}
											checked={selectedChannelId === channel.id}
											onChange={() => setSelectedChannelId(channel.id)}
										/>
										{channel.name}
									</label>
								))}
							</div>
						</div>
					)}

					<div>
						<p style={{ marginBottom: 'calc(var(--base) * 0.5)', fontWeight: 600 }}>
							Select device
						</p>
						{devices.length === 0 && (
							<p style={{ color: 'var(--theme-elevation-500)' }}>No devices found.</p>
						)}
						{devices.length > 0 && (
							<div
								style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--base) * 0.5)' }}
							>
								{devices.map((device) => (
									<Button
										key={device.id}
										type="button"
										margin={false}
										buttonStyle="secondary"
										onClick={() => dial(device.id)}
									>
										<span
											style={{
												display: 'flex',
												flexDirection: 'column',
												alignItems: 'flex-start',
												gap: 2,
											}}
										>
											<strong>{device.alias}</strong>
											<small style={{ color: 'var(--theme-elevation-500)' }}>
												{device.online ? '● Online' : '○ Offline'} · {device.id}
											</small>
										</span>
									</Button>
								))}
							</div>
						)}
					</div>
				</div>
			</Drawer>
		</div>
	)
}
