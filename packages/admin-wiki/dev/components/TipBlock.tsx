'use client'

/** Renderer for the consumer `devTip` block, wired via the import map. */
export const TipBlock = ({ fields }: { fields: Record<string, unknown> }) => (
	<aside
		data-dev-renderer="devTip"
		style={{
			background: 'var(--theme-elevation-500)',
			borderInlineStart: '3px solid var(--theme-success-500)',
			borderRadius: '4px',
			marginBlock: '1rem',
			padding: '0.75rem 1rem',
		}}
	>
		<strong>Dev tip:</strong> {typeof fields.tip === 'string' ? fields.tip : null}
	</aside>
)
