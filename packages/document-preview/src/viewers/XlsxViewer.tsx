'use client'

import {
	XlsxViewer as ExtendXlsxViewer,
	useXlsxViewerController,
	type XlsxViewerController,
} from '@extend-ai/react-xlsx'
import { useTheme } from '@payloadcms/ui'
import { useMemo } from 'react'

import { OFFICE_MAX_BYTES } from '../shared/limits'
import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { InfoCard } from './InfoCard'
import { useFileContent } from './useFileContent'
import { PreviewLoading, WithFileContent } from './ViewerStatus'

type HeaderColors = { background: string; text: string }

/**
 * The admin's elevation tokens as concrete colors. The grid paints its row and
 * column headers on a canvas, which cannot resolve `var(--...)`, so they are
 * read off the element carrying the current theme.
 */
const useHeaderColors = (): HeaderColors | undefined => {
	const { theme } = useTheme()
	return useMemo(() => {
		if (typeof document === 'undefined') {
			return undefined
		}
		const themed = document.querySelector(`[data-theme="${theme}"]`) ?? document.documentElement
		const styles = getComputedStyle(themed)
		const background = styles.getPropertyValue('--theme-elevation-50').trim()
		const text = styles.getPropertyValue('--theme-elevation-500').trim()
		return background && text ? { background, text } : undefined
	}, [theme])
}

/** Excel's name box and formula bar, read-only: the selection's address and the active cell's formula or value. */
const FormulaBar = ({ controller }: { controller: XlsxViewerController }) => {
	const address = controller.selectedRangeAddress ?? controller.activeCellAddress ?? ''
	const formula = controller.selectedFormula
	const content = formula || controller.selectedValue
	return (
		<div className="document-preview-xlsx__formula-bar">
			<span className="document-preview-xlsx__address">{address}</span>
			<span
				className="document-preview-xlsx__formula"
				data-formula={formula ? 'true' : undefined}
				title={content}
			>
				{content}
			</span>
		</div>
	)
}

/** Sheet tabs along the bottom, as in Excel, and the zoom controls. */
const SheetBar = ({ controller }: { controller: XlsxViewerController }) => {
	const { t } = useTranslation()
	return (
		<div className="document-preview-toolbar document-preview-xlsx__sheet-bar">
			<div className="document-preview-xlsx__tabs" role="tablist">
				{controller.tabs.map((tab, index) => (
					<button
						aria-selected={index === controller.activeTabIndex}
						className="document-preview-xlsx__tab"
						key={tab.id}
						onClick={() => controller.setActiveTabIndex(index)}
						role="tab"
						title={tab.name}
						type="button"
					>
						{tab.name}
					</button>
				))}
			</div>
			<div className="document-preview-xlsx__zoom">
				<button
					aria-label={t(keys.zoomOut)}
					className="document-preview-toolbar__button"
					disabled={!controller.canZoomOut}
					onClick={controller.zoomOut}
					title={t(keys.zoomOut)}
					type="button"
				>
					−
				</button>
				<button
					className="document-preview-toolbar__button document-preview-toolbar__value"
					onClick={controller.resetZoom}
					title={t(keys.actualSize)}
					type="button"
				>
					{Math.round(controller.zoomScale * 100)}%
				</button>
				<button
					aria-label={t(keys.zoomIn)}
					className="document-preview-toolbar__button"
					disabled={!controller.canZoomIn}
					onClick={controller.zoomIn}
					title={t(keys.zoomIn)}
					type="button"
				>
					+
				</button>
			</div>
		</div>
	)
}

const Workbook = ({ buffer, file }: { buffer: ArrayBuffer; file: DocumentPreviewViewerProps }) => {
	const headerColors = useHeaderColors()
	const controller = useXlsxViewerController({
		file: buffer,
		fileName: file.filename,
		maxFileSizeBytes: OFFICE_MAX_BYTES,
		readOnly: true,
	})
	const card = (reason: 'failed' | 'tooLarge') => (
		<InfoCard
			filename={file.filename}
			filesize={file.filesize}
			mimeType={file.mimeType}
			reason={reason}
		/>
	)
	return (
		<div className="document-preview-xlsx">
			<FormulaBar controller={controller} />
			<div className="document-preview-xlsx__grid">
				<ExtendXlsxViewer
					controller={controller}
					errorState={(error) => {
						console.error(`[document-preview] could not parse ${file.url}`, error)
						return card('failed')
					}}
					fileTooLargeState={card('tooLarge')}
					headerBackgroundColor={headerColors?.background}
					headerTextColor={headerColors?.text}
					height="100%"
					loadingState={<PreviewLoading />}
					readOnly
					rounded={false}
					showDefaultToolbar={false}
				/>
			</div>
			{controller.tabs.length > 0 ? <SheetBar controller={controller} /> : null}
		</div>
	)
}

/**
 * Spreadsheets (XLSX, XLSM and legacy XLS) through extend's grid: computed
 * formulas, charts, images. The grid stays light whatever the admin theme, so
 * cells read as authored; the chrome around it (formula bar, sheet tabs, zoom,
 * row and column headers) is the plugin's own, in admin tokens.
 */
export const XlsxViewer = (props: DocumentPreviewViewerProps) => {
	const state = useFileContent({
		filesize: props.filesize,
		kind: 'arrayBuffer',
		maxBytes: OFFICE_MAX_BYTES,
		url: props.url,
	})
	return (
		<WithFileContent file={props} state={state}>
			{(buffer) => <Workbook buffer={buffer} file={props} />}
		</WithFileContent>
	)
}
