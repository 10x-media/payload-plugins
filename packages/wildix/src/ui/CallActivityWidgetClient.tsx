'use client'

import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

export type CallActivityChartData = {
	labels: string[]
	inbound: number[]
	outbound: number[]
	statusCounts: Record<string, number[]>
}

const STATUS_COLORS: Record<string, string> = {
	completed: 'rgba(16, 185, 129, 0.7)',
	missed: 'rgba(239, 68, 68, 0.7)',
	ringing: 'rgba(251, 191, 36, 0.7)',
	voicemail: 'rgba(139, 92, 246, 0.7)',
	rejected: 'rgba(249, 115, 22, 0.7)',
	connected: 'rgba(59, 130, 246, 0.7)',
}

type Props = {
	data: CallActivityChartData
}

export const CallActivityWidgetClient = ({ data }: Props) => {
	const datasets = [
		{
			label: 'Inbound',
			data: data.inbound,
			backgroundColor: 'rgba(59, 130, 246, 0.7)',
			stack: 'direction',
		},
		{
			label: 'Outbound',
			data: data.outbound,
			backgroundColor: 'rgba(16, 185, 129, 0.7)',
			stack: 'direction',
		},
		...Object.entries(data.statusCounts).map(([status, counts]) => ({
			label: status.charAt(0).toUpperCase() + status.slice(1),
			data: counts,
			backgroundColor: STATUS_COLORS[status] ?? 'rgba(156, 163, 175, 0.7)',
			stack: 'status',
		})),
	]

	return (
		<Bar
			data={{
				labels: data.labels,
				datasets,
			}}
			options={{
				responsive: true,
				plugins: {
					legend: { position: 'top' },
					tooltip: { mode: 'index', intersect: false },
				},
				scales: {
					x: { stacked: true },
					y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
				},
			}}
		/>
	)
}
