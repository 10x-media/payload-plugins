import type React from 'react'

// Admin component overrides for the phone showcase: each one proves the field's
// RenderCustomComponent wiring picks the configured component over its own fallback.
const note: React.CSSProperties = {
	color: 'var(--theme-elevation-500)',
	display: 'block',
	fontSize: '0.8rem',
}

// htmlFor must match PhoneNumberField's own id convention (dots become double underscores)
// so the label stays associated with the input it names.
export const PhoneShowcaseLabel: React.FC<{ path?: string }> = ({ path }) => (
	<label className="field-label" htmlFor={path && `field-${path.replace(/\./g, '__')}`}>
		Custom Label component
	</label>
)

export const PhoneShowcaseDescription: React.FC = () => (
	<div className="field-description">Custom Description component</div>
)

export const PhoneShowcaseError: React.FC = () => <span style={note}>Custom Error component</span>

export const PhoneShowcaseBeforeInput: React.FC = () => <span style={note}>Custom beforeInput</span>

export const PhoneShowcaseAfterInput: React.FC = () => <span style={note}>Custom afterInput</span>
