'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import Papa from 'papaparse'
import { useMemo, useRef } from 'react'

import { CSV_MAX_BYTES } from '../shared/limits'
import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { useFileContent } from './useFileContent'
import { WithFileContent } from './ViewerStatus'

const ROW_HEIGHT = 30
const HEADER_HEIGHT = 32

/** Rows sampled to size columns; enough to be representative, cheap on large files. */
const WIDTH_SAMPLE_ROWS = 200

const MIN_COLUMN_PX = 64
const MAX_COLUMN_PX = 360
/** Horizontal cell padding plus border, added to the measured text. */
const CELL_CHROME_PX = 18

/**
 * Column widths in pixels from the widest sampled cell, measured with the
 * cell's font. Both axes are virtualized, so every column needs a known width
 * before it renders.
 */
const measureColumns = (rows: string[][], columnCount: number, font: string): number[] => {
	const context = document.createElement('canvas').getContext('2d')
	const widths = Array.from({ length: columnCount }, () => MIN_COLUMN_PX)
	if (!context) {
		return widths
	}
	context.font = font
	for (const row of rows.slice(0, WIDTH_SAMPLE_ROWS)) {
		row.forEach((cell, index) => {
			const text = cell.length > 80 ? cell.slice(0, 80) : cell
			const width = context.measureText(text).width + CELL_CHROME_PX
			widths[index] = Math.min(MAX_COLUMN_PX, Math.max(widths[index] ?? 0, Math.ceil(width)))
		})
	}
	return widths
}

const CsvTable = ({ mimeType, text }: { mimeType: string; text: string }) => {
	const { t } = useTranslation()
	const scrollRef = useRef<HTMLDivElement>(null)
	const { body, gutter, header, widths } = useMemo(() => {
		const parsed = Papa.parse<string[]>(text, {
			delimiter: mimeType === 'text/tab-separated-values' ? '\t' : '',
			skipEmptyLines: 'greedy',
		})
		const rows = parsed.data
		const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
		const fontFamily = getComputedStyle(document.body).fontFamily
		return {
			body: rows.slice(1),
			gutter: String(rows.length).length * 8 + 20,
			header: rows[0] ?? [],
			widths: measureColumns(rows, columnCount, `12px ${fontFamily}`),
		}
	}, [mimeType, text])

	const rows = useVirtualizer({
		count: body.length,
		estimateSize: () => ROW_HEIGHT,
		getScrollElement: () => scrollRef.current,
		overscan: 12,
		scrollPaddingStart: HEADER_HEIGHT,
	})
	const columns = useVirtualizer({
		count: widths.length,
		estimateSize: (index) => widths[index] ?? MIN_COLUMN_PX,
		getScrollElement: () => scrollRef.current,
		horizontal: true,
		overscan: 4,
	})
	const virtualColumns = columns.getVirtualItems()
	const width = gutter + columns.getTotalSize()

	return (
		<div className="document-preview-csv">
			<div className="document-preview-csv__scroll" ref={scrollRef}>
				<div
					className="document-preview-csv__canvas"
					style={{ height: HEADER_HEIGHT + rows.getTotalSize(), width }}
				>
					<div
						className="document-preview-csv__row document-preview-csv__row--header"
						style={{ height: HEADER_HEIGHT, width }}
					>
						<span className="document-preview-csv__gutter" style={{ width: gutter }} />
						{virtualColumns.map((column) => (
							<span
								className="document-preview-csv__cell"
								key={column.key}
								style={{ left: gutter + column.start, width: column.size }}
								title={header[column.index]}
							>
								{header[column.index]}
							</span>
						))}
					</div>
					{rows.getVirtualItems().map((row) => {
						const cells = body[row.index]
						return (
							<div
								className="document-preview-csv__row"
								key={row.key}
								style={{ height: ROW_HEIGHT, top: HEADER_HEIGHT + row.start, width }}
							>
								<span className="document-preview-csv__gutter" style={{ width: gutter }}>
									{row.index + 1}
								</span>
								{virtualColumns.map((column) => (
									<span
										className="document-preview-csv__cell"
										key={column.key}
										style={{ left: gutter + column.start, width: column.size }}
										title={cells?.[column.index]}
									>
										{cells?.[column.index]}
									</span>
								))}
							</div>
						)
					})}
				</div>
			</div>
			<div className="document-preview-toolbar">
				<span className="document-preview-toolbar__value">
					{t(keys.rowCount, { count: body.length.toLocaleString() })} ·{' '}
					{t(keys.columnCount, { count: widths.length.toLocaleString() })}
				</span>
			</div>
		</div>
	)
}

/** CSV and TSV as a table virtualized on both axes, the first row as its header. */
export const CsvViewer = (props: DocumentPreviewViewerProps) => {
	const state = useFileContent({
		filesize: props.filesize,
		kind: 'text',
		maxBytes: CSV_MAX_BYTES,
		url: props.url,
	})
	return (
		<WithFileContent file={props} state={state}>
			{(text) => <CsvTable mimeType={props.mimeType} text={text} />}
		</WithFileContent>
	)
}
