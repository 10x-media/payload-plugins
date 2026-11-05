import type { TrendPoint } from './TrendChart'
import { tooltipLabelOf } from './trendGeometry'

export interface InProgressArgs {
	now: Date
	/** The end of the window the series was read for. */
	end: Date
	/** The bucket's label as its tooltip and data table read it while it is still counting. */
	soFar: (period: string) => string
}

/**
 * Marks the bucket `now` falls in as still counting ("so far") while the window reaches `now`. The
 * readings stay as they are, so every total still adds up.
 */
export const markInProgress = (
	points: TrendPoint[],
	{ now, end, soFar }: InProgressArgs
): TrendPoint[] => {
	if (now.getTime() > end.getTime()) {
		return points
	}
	const counting = points.findLastIndex((point) => {
		const start = Date.parse(point.at)
		return !Number.isNaN(start) && start <= now.getTime()
	})
	return points.map((point, i) =>
		i === counting
			? { ...point, inProgress: true, tooltipLabel: soFar(tooltipLabelOf(point)) }
			: point
	)
}
