import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.undo]: 'Deshacer',
	[keys.redo]: 'Rehacer',
	[keys.debug]: 'Historial de deshacer',
	[keys.debugTooltip]: 'Inspeccionar el historial de deshacer',
	[keys.debugTitle]: 'Historial de deshacer',
	[keys.debugEmpty]: 'Todavía no se ha registrado ningún historial.',
	[keys.debugClose]: 'Cerrar',
	[keys.debugPending]: 'Pendiente (sin registrar)',
	[keys.debugOriginal]: 'Estado original',
	[keys.debugCopy]: 'Copiar JSON',
}
