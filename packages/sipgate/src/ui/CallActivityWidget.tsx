import type { WidgetServerProps } from 'payload'
import type { CallActivityChartData } from './CallActivityWidgetClient'
import { CallActivityWidgetClient } from './CallActivityWidgetClient'

const DAYS = 14

function buildLabels(): string[] {
	return Array.from({ length: DAYS }, (_, i) => {
		const d = new Date()
		d.setDate(d.getDate() - (DAYS - 1 - i))
		return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
	})
}

function dateKey(date: Date): string {
	return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

const CallActivityWidget = async (props: WidgetServerProps) => {
	const { req } = props

	const since = new Date()
	since.setDate(since.getDate() - DAYS)

	const result = await req.payload.find({
		collection: 'call-logs',
		limit: 1000,
		where: { startedAt: { greater_than: since.toISOString() } },
		sort: 'startedAt',
		overrideAccess: true,
	})

	const STATUSES = ['completed', 'missed', 'ringing', 'voicemail', 'rejected', 'connected'] as const

	const labels = buildLabels()
	const inbound = new Array<number>(DAYS).fill(0)
	const outbound = new Array<number>(DAYS).fill(0)
	const statusCounts: Record<string, number[]> = Object.fromEntries(
		STATUSES.map((s) => [s, new Array<number>(DAYS).fill(0)])
	)

	for (const log of result.docs) {
		if (!log.startedAt) continue
		const key = dateKey(new Date(log.startedAt as string))
		const idx = labels.indexOf(key)
		if (idx === -1) continue
		if (log.callType === 'in') inbound[idx] = (inbound[idx] ?? 0) + 1
		else if (log.callType === 'out') outbound[idx] = (outbound[idx] ?? 0) + 1
		const status = log.callStatus as string
		if (status && statusCounts[status]) {
			statusCounts[status][idx] = (statusCounts[status][idx] ?? 0) + 1
		}
	}

	const chartData: CallActivityChartData = { labels, inbound, outbound, statusCounts }

	return (
		<div style={{ padding: '1rem' }}>
			<h2 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Call Activity (last {DAYS} days)</h2>
			<CallActivityWidgetClient data={chartData} />
		</div>
	)
}

export default CallActivityWidget
