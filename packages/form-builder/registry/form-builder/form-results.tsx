'use client'

import type { FieldAggregation } from '@10x-media/form-builder/react'
import type { ReactNode } from 'react'

export type FormResultsProps = {
	results: FieldAggregation | FieldAggregation[]
	t?: (key: string) => string
	locale?: string
	showCounts?: boolean
	/** The recorded outcome's stable option value; the matching bucket is highlighted as the winner. */
	winningValue?: string
}

function OneResult({
	result,
	showCounts,
	winningValue,
}: {
	result: FieldAggregation
	showCounts: boolean
	winningValue?: string
}): ReactNode {
	if (result.total === 0) {
		return (
			<section className="my-4">
				{result.label ? <h3 className="mb-2 font-medium">{result.label}</h3> : null}
				<p className="text-sm text-muted-foreground">No responses yet</p>
			</section>
		)
	}
	return (
		<section className="my-4">
			{result.label ? <h3 className="mb-2 font-medium">{result.label}</h3> : null}
			<ul className="grid list-none gap-2 p-0">
				{result.buckets.map((bucket) => {
					const isWinner = winningValue != null && bucket.value === winningValue
					return (
						<li
							key={bucket.value}
							className={`grid grid-cols-[minmax(6rem,12rem)_1fr_auto_auto] items-center gap-2${isWinner ? ' fb-results__bucket--winner font-semibold' : ''}`}
						>
							<span className="truncate">
								{bucket.label}
								{isWinner ? (
									<span className="ms-1.5 text-xs uppercase tracking-wide text-muted-foreground">
										Winner
									</span>
								) : null}
							</span>
							<span className="h-3 overflow-hidden rounded bg-muted" aria-hidden="true">
								<span
									data-fb-results-fill
									className="block h-full bg-primary"
									style={{ width: `${bucket.percentage}%` }}
								/>
							</span>
							<span className="tabular-nums">{bucket.percentage}%</span>
							{showCounts ? (
								<span className="tabular-nums text-muted-foreground">{bucket.count}</span>
							) : null}
						</li>
					)
				})}
			</ul>
			<p className="mt-2 text-sm text-muted-foreground">
				{result.total} responses{result.truncated ? ' (sample)' : ''}
			</p>
		</section>
	)
}

/** shadcn-styled poll/survey results: per-option bars with percentages. Data resolved server-side and passed in. */
export function FormResults({ results, showCounts = true, winningValue }: FormResultsProps) {
	const list = Array.isArray(results) ? results : [results]
	return (
		<div className="fb-results">
			{list.map((result) => (
				<OneResult
					key={result.field}
					result={result}
					showCounts={showCounts}
					winningValue={winningValue}
				/>
			))}
		</div>
	)
}
