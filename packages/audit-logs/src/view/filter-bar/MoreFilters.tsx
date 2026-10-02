'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { Filters } from '../types'
import { RefPicker, ValuesInput } from './RefPicker'
import type { EditorProps } from './types'

type Props = EditorProps & {
	documentCollections: string[]
	labels: Record<string, string>
	onLabel: (ref: string, label: string) => void
	titleFields: Record<string, string>
}

/** The rare filters, all on one screen, each taking several values. */
export function MoreFilters({
	documentCollections,
	labels,
	onLabel,
	setStaged,
	staged,
	titleFields,
}: Props) {
	const { t } = useTranslation()
	const set = (field: 'changedPaths' | 'documents' | 'groups') => (values?: string[]) =>
		setStaged((f): Filters => ({ ...f, [field]: values }))

	return (
		<div className="al-panel-grid">
			{/* The view reads a global's slug from documentId, so the two cannot coexist. */}
			{!staged.globals?.length && (
				<RefPicker
					collections={documentCollections}
					label={t(keys.filterDocument)}
					labels={labels}
					onChange={set('documents')}
					onLabel={onLabel}
					refs={staged.documents ?? []}
					titleFields={titleFields}
				/>
			)}
			<ValuesInput
				label={t(keys.filterChangedPath)}
				onChange={set('changedPaths')}
				placeholder={t(keys.fieldPathPlaceholder)}
				values={staged.changedPaths ?? []}
			/>
			<ValuesInput
				label={t(keys.filterGroup)}
				onChange={set('groups')}
				placeholder={t(keys.groupPlaceholder)}
				values={staged.groups ?? []}
			/>
		</div>
	)
}
