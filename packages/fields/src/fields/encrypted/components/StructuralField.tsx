'use client'
import type React from 'react'
import { useCallback, useState } from 'react'
import { EyeToggle } from './EyeToggle'
import {
	CheckboxFace,
	CodeFace,
	DateFace,
	JsonFace,
	PointFace,
	RadioFace,
	SelectFace,
} from './facsimiles'
import type { EncryptedFieldConfig } from './placement'

type NativeComponent = React.ComponentType<Record<string, unknown>>

/**
 * Faces keyed by structural type. Anything absent (a `hasMany` text/email/number
 * field, which Payload renders as a react-select chip surface) falls back to the
 * select face, so the concealed run of dots never leaks the selection count.
 */
const STRUCTURAL_FACES: Record<
	string,
	React.FC<{ field: EncryptedFieldConfig; maskDots: number; path: string }>
> = {
	checkbox: CheckboxFace,
	code: CodeFace,
	date: DateFace,
	json: JsonFace,
	point: PointFace,
	radio: RadioFace,
	select: SelectFace,
}

/**
 * Wrapper for every label-row type. The native component mounts on first reveal
 * and then stays mounted; concealing only sets display:none on its slot, so
 * re-revealing a select or datepicker never remounts it (that remount was the
 * toggle flicker). Until the first reveal the native is absent, so the decrypted
 * value only enters the DOM once the admin chooses to reveal it. The concealed
 * face never binds form state, and the eye is pinned to the label line so
 * toggling never shifts layout or moves focus.
 */
export const StructuralField: React.FC<{
	componentKey: string
	field: EncryptedFieldConfig
	maskDots: number
	Native: NativeComponent
	nativeProps: Record<string, unknown>
	path: string
}> = ({ componentKey, field, maskDots, Native, nativeProps, path }) => {
	const [revealed, setRevealed] = useState(false)
	const [mounted, setMounted] = useState(false)
	const toggle = useCallback(() => {
		setRevealed((prev) => !prev)
		setMounted(true)
	}, [])
	const Face = STRUCTURAL_FACES[componentKey] ?? SelectFace
	return (
		<div className="tenx-protected-field tenx-protected-field--label-row">
			{mounted ? (
				<div className={revealed ? undefined : 'tenx-protected-field__reveal-slot--hidden'}>
					<Native {...nativeProps} />
				</div>
			) : null}
			{revealed ? null : <Face field={field} maskDots={maskDots} path={path} />}
			<div className="tenx-protected-field__eye-wrap tenx-protected-field__eye-wrap--label-row">
				<EyeToggle
					className="tenx-protected-field__eye--floating"
					onToggle={toggle}
					revealed={revealed}
				/>
			</div>
		</div>
	)
}
