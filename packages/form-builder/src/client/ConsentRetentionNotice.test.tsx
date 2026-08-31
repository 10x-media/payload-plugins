import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsentRetentionNotice } from './ConsentRetentionNotice'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children, type }: { children?: unknown; type?: string }) => (
		<div data-testid="banner" data-type={type}>
			{children as string}
		</div>
	),
}))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

afterEach(() => {
	cleanup()
})

describe('ConsentRetentionNotice', () => {
	it('renders the translated retention warning as an info banner', () => {
		render(<ConsentRetentionNotice />)
		expect(screen.getByTestId('banner')).toHaveAttribute('data-type', 'info')
		expect(screen.getByTestId('banner')).toHaveTextContent(
			'formBuilder:form.consentRetentionNotice'
		)
	})
})
