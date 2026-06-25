'use client'

import { Button, Drawer, useModal } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SipgateRtcmAction } from '../utils/sipgateRtcmHandler'

type SipgateDevice = {
	id: string
	alias: string
	type: string
	online: boolean
	registered: { userAgent: string }[]
}

const ACCEPT_DRAWER_SLUG = 'sipgate-accept-device-picker'

type ActiveCall = {
	callId: string
	from: string
	to: string
	direction: 'in' | 'out'
	status: 'ringing' | 'active'
	held: boolean
	muted: boolean
	recording: boolean
}

export const LiveCallFloatingWindowClient = () => {
	const [mounted, setMounted] = useState(false)
	const [open, setOpen] = useState(false)
	const [calls, setCalls] = useState<ActiveCall[]>([])
	const [acceptingCall, setAcceptingCall] = useState<ActiveCall | null>(null)
	const [devices, setDevices] = useState<SipgateDevice[]>([])
	const [devicesLoading, setDevicesLoading] = useState(false)
	const { openModal, closeModal } = useModal()

	useEffect(() => {
		setMounted(true)
	}, [])

	useEffect(() => {
		const fetch_ = async () => {
			try {
				const res = await fetch('/api/sipgate/active-call')
				if (res.ok) setCalls(await res.json())
			} catch {}
		}
		fetch_()
		const id = setInterval(fetch_, 3000)
		return () => clearInterval(id)
	}, [])

	const sendRtcm = async (
		call: ActiveCall,
		action: SipgateRtcmAction,
		extra?: Record<string, unknown>
	) => {
		const res = await fetch('/api/sipgate/rtcm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ callId: call.callId, action, ...extra }),
		})
		if (res.ok) {
			const updated = await res.json()
			if (updated && typeof updated === 'object' && 'callId' in updated) {
				setCalls((prev) => prev.map((c) => (c.callId === call.callId ? { ...c, ...updated } : c)))
			}
		}
	}

	const openAcceptDrawer = (call: ActiveCall) => {
		setAcceptingCall(call)
		setDevicesLoading(true)
		fetch('/api/sipgate/devices')
			.then((r) => (r.ok ? r.json() : []))
			.then(setDevices)
			.catch(() => {})
			.finally(() => setDevicesLoading(false))
		openModal(ACCEPT_DRAWER_SLUG)
	}

	const handleAcceptWithDevice = async (deviceId: string) => {
		if (!acceptingCall) return
		closeModal(ACCEPT_DRAWER_SLUG)
		await sendRtcm(acceptingCall, 'answer', { deviceId }).catch(() => {})
		setAcceptingCall(null)
	}

	const handleHangup = (call: ActiveCall) => {
		sendRtcm(call, 'hangup')
			.then(() => setCalls((prev) => prev.filter((c) => c.callId !== call.callId)))
			.catch(() => {})
	}
	const handleHold = (call: ActiveCall) => sendRtcm(call, 'hold').catch(() => {})
	const handleMute = (call: ActiveCall) => sendRtcm(call, 'mute').catch(() => {})
	const handleRecordings = (call: ActiveCall) => sendRtcm(call, 'recordings').catch(() => {})

	if (!mounted) return null
	return createPortal(
		<div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
			<button type="button" onClick={() => setOpen((v) => !v)}>
				📞 {calls.length > 0 && `(${calls.length})`}
			</button>
			{open && (
				<div
					style={{
						position: 'absolute',
						bottom: 48,
						right: 0,
						width: 280,
						background: '#fff',
						border: '1px solid #ccc',
						padding: 12,
					}}
				>
					{calls.length === 0 ? (
						<p>No active calls</p>
					) : (
						calls.map((call) => (
							<div key={call.callId} style={{ marginBottom: 8 }}>
								<div>
									{call.direction === 'in' ? `${call.from} → you` : `you → ${call.to}`}
									{' · '}
									{call.status === 'ringing'
										? call.direction === 'in'
											? 'Incoming'
											: 'Ringing...'
										: 'Active'}
								</div>
								{call.status === 'ringing' && call.direction === 'in' && (
									<>
										<button type="button" onClick={() => openAcceptDrawer(call)}>
											Transfer
										</button>
										<button type="button" onClick={() => handleHangup(call)}>
											Decline
										</button>
									</>
								)}
								{call.status === 'ringing' && call.direction === 'out' && (
									<button type="button" onClick={() => handleHangup(call)}>
										Cancel
									</button>
								)}
								{call.status === 'active' && (
									<>
										<button
											type="button"
											aria-pressed={call.held}
											style={{ fontWeight: call.held ? 'bold' : undefined }}
											onClick={() => handleHold(call)}
										>
											{call.held ? 'Unhold' : 'Hold'}
										</button>
										<button
											type="button"
											aria-pressed={call.muted}
											style={{ fontWeight: call.muted ? 'bold' : undefined }}
											onClick={() => handleMute(call)}
										>
											{call.muted ? 'Unmute' : 'Mute'}
										</button>
										<button
											type="button"
											aria-pressed={call.recording}
											style={{ fontWeight: call.recording ? 'bold' : undefined }}
											onClick={() => handleRecordings(call)}
										>
											{call.recording ? 'Stop Recording' : 'Record'}
										</button>
										<button type="button" onClick={() => handleHangup(call)}>
											Hang up
										</button>
									</>
								)}
							</div>
						))
					)}
				</div>
			)}

			<Drawer
				slug={ACCEPT_DRAWER_SLUG}
				title={acceptingCall ? `Accept call from ${acceptingCall.from}` : 'Accept call'}
			>
				<div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
					{devicesLoading ? <p>Loading devices...</p> : null}
					{!devicesLoading && devices.length === 0 && <p>No devices found.</p>}
					{!devicesLoading &&
						devices.map((device) => (
							<Button
								key={device.id}
								type="button"
								margin={false}
								buttonStyle="secondary"
								onClick={() => handleAcceptWithDevice(device.id)}
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
		</div>,
		document.body
	)
}
