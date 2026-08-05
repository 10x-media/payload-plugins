'use client'

import { Button, Drawer, useModal } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LiveCallPosition } from '../types'
import type { WildixRtcmAction } from '../utils/wildixRtcmHandler'
import { PhoneIcon } from './PhoneIcon'

type WildixDevice = {
	contact: string
	userAgent: string
	online: boolean
	isActiveDevice: boolean
}

const ACCEPT_DRAWER_SLUG = 'wildix-accept-device-picker'

type ActiveCall = {
	sipCallId: string
	callId: string
	from: string
	to: string
	direction: 'in' | 'out'
	status: 'ringing' | 'active'
	held: boolean
}

const EDGE = 'calc(var(--base) * 1.5)'
const PANEL_GAP = 'calc(var(--base) * 0.5)'

type PanelAnchor = {
	container: React.CSSProperties
	panel: React.CSSProperties
}

const anchorStyles = (position: LiveCallPosition): PanelAnchor => {
	const isBottom = position.startsWith('bottom')
	const isRight = position.endsWith('right')

	const container: React.CSSProperties = {
		position: 'fixed',
		zIndex: 60,
		...(isBottom ? { bottom: EDGE } : { top: EDGE }),
		...(isRight ? { right: EDGE } : { left: EDGE }),
	}

	const panel: React.CSSProperties = {
		position: 'absolute',
		...(isBottom ? { bottom: `calc(100% + ${PANEL_GAP})` } : { top: `calc(100% + ${PANEL_GAP})` }),
		...(isRight ? { right: 0 } : { left: 0 }),
		width: 320,
		background: 'var(--theme-elevation-0)',
		border: '1px solid var(--theme-elevation-150)',
		borderRadius: 'var(--style-radius-l)',
		boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
		overflow: 'hidden',
	}

	return { container, panel }
}

const statusPill = (status: ActiveCall['status']): React.CSSProperties => {
	const isRinging = status === 'ringing'
	return {
		display: 'inline-block',
		padding: '2px 8px',
		borderRadius: 'var(--style-radius-s)',
		fontSize: '0.7rem',
		fontWeight: 600,
		background: isRinging ? 'var(--theme-warning-100)' : 'var(--theme-success-100)',
		color: isRinging ? 'var(--theme-warning-700)' : 'var(--theme-success-700)',
		marginBottom: 'calc(var(--base) * 0.4)',
	}
}

const pillLabel = (status: ActiveCall['status'], direction: ActiveCall['direction']): string => {
	if (status === 'ringing') return direction === 'in' ? 'Incoming' : 'Ringing...'
	return 'Active'
}

const CallCard = ({
	call,
	onHold,
	onHangup,
	onOpenAccept,
}: {
	call: ActiveCall
	onHold: () => void
	onHangup: () => void
	onOpenAccept: () => void
}) => (
	<div
		style={{
			background: 'var(--theme-elevation-50)',
			border: '1px solid var(--theme-elevation-100)',
			borderRadius: 'var(--style-radius-m)',
			padding: 'calc(var(--base) * 0.75)',
			display: 'flex',
			flexDirection: 'column',
			gap: 'calc(var(--base) * 0.5)',
		}}
	>
		<div>
			<span style={statusPill(call.status)}>{pillLabel(call.status, call.direction)}</span>
			<div style={{ color: 'var(--theme-elevation-800)', fontSize: '0.875rem', fontWeight: 500 }}>
				{call.direction === 'in' ? `${call.from} \u2192 you` : `you \u2192 ${call.to}`}
			</div>
		</div>

		<div style={{ display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--base) * 0.35)' }}>
			{call.status === 'ringing' && call.direction === 'in' && (
				<>
					<Button
						type="button"
						buttonStyle="secondary"
						size="small"
						margin={false}
						onClick={onOpenAccept}
					>
						Answer
					</Button>
					<Button type="button" buttonStyle="error" size="small" margin={false} onClick={onHangup}>
						Decline
					</Button>
				</>
			)}
			{call.status === 'ringing' && call.direction === 'out' && (
				<Button type="button" buttonStyle="error" size="small" margin={false} onClick={onHangup}>
					Cancel
				</Button>
			)}
			{call.status === 'active' && (
				<>
					<Button
						type="button"
						buttonStyle="secondary"
						size="small"
						margin={false}
						aria-pressed={call.held}
						onClick={onHold}
					>
						{call.held ? 'Unhold' : 'Hold'}
					</Button>
					<Button type="button" buttonStyle="error" size="small" margin={false} onClick={onHangup}>
						Hang up
					</Button>
				</>
			)}
		</div>
	</div>
)

export const LiveCallFloatingWindowClient = ({
	initialDevices,
	position = 'bottom-right',
}: {
	initialDevices: WildixDevice[]
	position?: LiveCallPosition
}) => {
	const [mounted, setMounted] = useState(false)
	const [open, setOpen] = useState(false)
	const [calls, setCalls] = useState<ActiveCall[]>([])
	const [acceptingCall, setAcceptingCall] = useState<ActiveCall | null>(null)
	const [devices] = useState<WildixDevice[]>(initialDevices)
	const { openModal, closeModal } = useModal()

	useEffect(() => {
		setMounted(true)
	}, [])

	useEffect(() => {
		const poll = async () => {
			try {
				const res = await fetch('/api/wildix/active-call')
				if (res.ok) {
					const data = (await res.json()) as { calls: ActiveCall[] }
					setCalls(data.calls ?? [])
				}
			} catch {}
		}
		poll()
		const id = setInterval(poll, 3000)
		return () => clearInterval(id)
	}, [])

	const sendRtcm = async (
		call: ActiveCall,
		action: WildixRtcmAction,
		extra?: Record<string, unknown>
	) => {
		const res = await fetch('/api/wildix/rtcm', {
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

	if (!mounted) return null

	const hasCalls = calls.length > 0
	const { container, panel } = anchorStyles(position)
	const iconColor = hasCalls ? 'var(--theme-elevation-0)' : 'var(--theme-elevation-800)'

	return createPortal(
		<div style={container}>
			{open && (
				<div style={panel}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: 'calc(var(--base) * 0.6) calc(var(--base) * 0.75)',
							borderBottom: '1px solid var(--theme-elevation-100)',
						}}
					>
						<span
							style={{
								color: 'var(--theme-elevation-800)',
								fontSize: '0.8rem',
								fontWeight: 600,
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							}}
						>
							Active Calls
							{hasCalls && (
								<span
									style={{
										marginLeft: 'calc(var(--base) * 0.35)',
										color: 'var(--theme-elevation-500)',
									}}
								>
									({calls.length})
								</span>
							)}
						</span>
						<button
							type="button"
							onClick={() => setOpen(false)}
							style={{
								background: 'none',
								border: 'none',
								cursor: 'pointer',
								color: 'var(--theme-elevation-500)',
								fontSize: '1rem',
								lineHeight: 1,
								padding: 2,
							}}
							aria-label="Close"
						>
							✕
						</button>
					</div>

					<div
						style={{
							padding: 'calc(var(--base) * 0.75)',
							maxHeight: 480,
							overflowY: 'auto',
							display: 'flex',
							flexDirection: 'column',
							gap: 'calc(var(--base) * 0.5)',
						}}
					>
						{calls.length === 0 ? (
							<p style={{ color: 'var(--theme-elevation-500)', fontSize: '0.875rem', margin: 0 }}>
								No active calls
							</p>
						) : (
							calls.map((call) => (
								<CallCard
									key={call.callId}
									call={call}
									onHold={() => sendRtcm(call, 'hold').catch(() => {})}
									onHangup={() => handleHangup(call)}
									onOpenAccept={() => openAcceptDrawer(call)}
								/>
							))
						)}
					</div>
				</div>
			)}

			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				style={{
					position: 'relative',
					width: 48,
					height: 48,
					borderRadius: '50%',
					border: 'none',
					cursor: 'pointer',
					background: hasCalls ? 'var(--theme-success-500)' : 'var(--theme-elevation-200)',
					color: iconColor,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
					transition: 'background 0.2s',
				}}
				aria-label={open ? 'Close call window' : 'Open call window'}
			>
				<PhoneIcon color={iconColor} />
				{hasCalls && (
					<span
						style={{
							position: 'absolute',
							top: -4,
							right: -4,
							width: 18,
							height: 18,
							borderRadius: '50%',
							background: 'var(--theme-error-500)',
							color: 'var(--theme-elevation-0)',
							fontSize: '0.65rem',
							fontWeight: 700,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
						}}
					>
						{calls.length}
					</span>
				)}
			</button>

			<Drawer
				slug={ACCEPT_DRAWER_SLUG}
				title={acceptingCall ? `Accept call from ${acceptingCall.from}` : 'Accept call'}
			>
				<div
					style={{
						padding: 'var(--base)',
						display: 'flex',
						flexDirection: 'column',
						gap: 'calc(var(--base) * 0.5)',
					}}
				>
					{devices.length === 0 && (
						<p style={{ color: 'var(--theme-elevation-500)', margin: 0 }}>No devices found.</p>
					)}
					{devices.map((device) => (
						<Button
							key={device.contact}
							type="button"
							margin={false}
							buttonStyle="secondary"
							onClick={() => handleAcceptWithDevice(device.contact)}
						>
							<span
								style={{
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'flex-start',
									gap: 2,
								}}
							>
								<strong>{device.userAgent}</strong>
								<small style={{ color: 'var(--theme-elevation-500)' }}>
									{device.online ? '● Online' : '○ Offline'}
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
