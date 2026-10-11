'use client'

import { useConfig } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import { useTranslation } from '../translations/useTranslation'

/**
 * The entry's time as Payload's list cells show dates: `admin.dateFormat`, in the
 * admin's language. The exact time to the second is on hover. Rendered straight
 * away like those cells; the server's time zone may differ from the browser's for
 * the first paint, which is what the hydration warning is silenced for.
 */
export function FormattedDate({ iso }: { iso: string }) {
	const { i18n } = useTranslation()
	const {
		config: {
			admin: { dateFormat },
		},
	} = useConfig()

	return (
		<span
			className="al-row__time"
			suppressHydrationWarning
			title={formatDate({ date: iso, i18n, pattern: 'PPpp' })}
		>
			{formatDate({ date: iso, i18n, pattern: dateFormat })}
		</span>
	)
}
