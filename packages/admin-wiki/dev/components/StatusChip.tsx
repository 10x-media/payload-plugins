'use client'

/**
 * Renderer for the consumer `devStatusChip` inline block. Returns a `<span>`:
 * an inline block renders inside a paragraph, where a block-level element would
 * be invalid markup.
 */
export const StatusChip = ({ fields }: { fields: Record<string, unknown> }) => (
	<span
		style={{
			background:
				fields.tone === 'deprecated' ? 'var(--theme-error-100)' : 'var(--theme-success-100)',
			borderRadius: '10px',
			fontSize: '0.8em',
			fontWeight: 600,
			padding: '0.1em 0.5em',
			whiteSpace: 'nowrap',
		}}
	>
		{typeof fields.label === 'string' ? fields.label : null}
	</span>
)
