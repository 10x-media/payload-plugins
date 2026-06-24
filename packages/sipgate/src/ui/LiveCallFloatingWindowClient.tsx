'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { transferCall } from '../utils/sipgate.rest'

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

	const sendRtcm = async (call: ActiveCall, action: string) => {
		const res = await fetch('/api/sipgate/rtcm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ callId: call.callId, action }),
		})
		if (res.ok) {
			const updated = await res.json()
			if (updated && typeof updated === 'object' && 'callId' in updated) {
				setCalls((prev) => prev.map((c) => (c.callId === call.callId ? { ...c, ...updated } : c)))
			}
		}
	}

	const handleAccept = (call: ActiveCall) => sendRtcm(call, 'answer').catch(() => {})
	const handleDecline = (call: ActiveCall) => sendRtcm(call, 'decline').catch(() => {})
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
										<button type="button" onClick={() => handleAccept(call)}>
											Accept
										</button>
										<button type="button" onClick={() => handleDecline(call)}>
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
		</div>,
		document.body
	)
}
