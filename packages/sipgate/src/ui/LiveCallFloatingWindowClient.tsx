'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ActiveCall = {
	callId: string
	from: string
	to: string
	direction: 'in' | 'out'
	status: 'ringing' | 'active'
}

export const LiveCallFloatingWindowClient = () => {
	const [open, setOpen] = useState(false)
	const [calls, setCalls] = useState<ActiveCall[]>([])

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

	if (typeof document === 'undefined') return null
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
										<button type="button">Accept</button>
										<button type="button">Decline</button>
									</>
								)}
								{call.status === 'ringing' && call.direction === 'out' && (
									<button type="button">Cancel</button>
								)}
								{call.status === 'active' && <button type="button">Hang up</button>}
							</div>
						))
					)}
				</div>
			)}
		</div>,
		document.body
	)
}
