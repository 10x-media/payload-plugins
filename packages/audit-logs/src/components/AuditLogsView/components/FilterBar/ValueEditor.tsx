'use client'

import type React from 'react'
import { keys } from '../../../../translations/keys'
import { useTranslation } from '../../../../translations/useTranslation'
import type { Filters, SelectOption } from '../../types'
import { OPERATION_OPTIONS } from './constants'
import { DateRangeEditor } from './DateRangeEditor'
import { MultiSelectEditor } from './MultiSelectEditor'
import { SingleValueEditor } from './SingleValueEditor'
import type { FilterField } from './types'
import { UserFilterEditor } from './UserFilterEditor'

type Props = {
	collectionSlugs: string[]
	field: FilterField
	globalSlugs: string[]
	index?: number
	onClose: () => void
	setStaged: React.Dispatch<React.SetStateAction<Filters>>
	staged: Filters
	tenantOptions?: SelectOption[]
	userTitleFields: Record<string, string>
}

export function ValueEditor({
	collectionSlugs,
	field,
	globalSlugs,
	index,
	onClose,
	setStaged,
	staged,
	tenantOptions,
	userTitleFields,
}: Props) {
	const { t } = useTranslation()

	if (field === 'collections') {
		return (
			<MultiSelectEditor
				field="collections"
				label={t(keys.filterCollection)}
				onClose={onClose}
				options={collectionSlugs.map((s) => ({ label: s, value: s }))}
				setStaged={setStaged}
				staged={staged}
			/>
		)
	}

	if (field === 'globals') {
		return (
			<MultiSelectEditor
				field="globals"
				label={t(keys.filterGlobal)}
				onClose={onClose}
				options={globalSlugs.map((s) => ({ label: s, value: s }))}
				setStaged={setStaged}
				staged={staged}
			/>
		)
	}

	if (field === 'operations') {
		return (
			<MultiSelectEditor
				field="operations"
				label={t(keys.filterOperation)}
				onClose={onClose}
				options={OPERATION_OPTIONS}
				setStaged={setStaged}
				staged={staged}
			/>
		)
	}

	if (field === 'tenant') {
		return (
			<MultiSelectEditor
				field="tenants"
				label={t(keys.filterTenant)}
				onClose={onClose}
				options={tenantOptions ?? []}
				setStaged={setStaged}
				staged={staged}
			/>
		)
	}

	if (field === 'userId') {
		return (
			<UserFilterEditor
				onClose={onClose}
				setStaged={setStaged}
				staged={staged}
				userTitleFields={userTitleFields}
			/>
		)
	}

	if (field === 'dateRange') {
		return <DateRangeEditor onClose={onClose} setStaged={setStaged} staged={staged} />
	}

	return (
		<SingleValueEditor
			field={field as 'changedPath' | 'documentId' | 'eventType' | 'group'}
			index={index}
			onClose={onClose}
			setStaged={setStaged}
			staged={staged}
			userTitleFields={userTitleFields}
		/>
	)
}
