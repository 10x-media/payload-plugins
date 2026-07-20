// @vitest-environment jsdom
import { render } from '@testing-library/react'
import type { DefaultServerCellComponentProps } from 'payload'
import { describe, expect, it } from 'vitest'
import { ProtectedCell } from './ProtectedCell'

const cellProps = (t: (key: string) => string): DefaultServerCellComponentProps =>
	({ i18n: { t } }) as unknown as DefaultServerCellComponentProps

describe('ProtectedCell', () => {
	it('translates the masked accessible label via the request i18n', () => {
		const { container } = render(
			<ProtectedCell
				{...cellProps((key) => (key === 'fields:encryptedValue' ? 'Verschlüsselter Wert' : key))}
			/>
		)
		const label = container.querySelector('[role="img"]')
		expect(label?.getAttribute('aria-label')).toBe('Verschlüsselter Wert')
	})
})
