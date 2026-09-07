import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Panel de ajustes',
	[keys.appearanceLabel]: 'Apariencia',
	[keys.back]: 'Atrás',
	[keys.close]: 'Cerrar',
	[keys.delete]: 'Eliminar',
	[keys.deleteBody]: 'Este documento se eliminará de forma permanente. No se puede deshacer.',
	[keys.deleteConfirm]: 'Eliminar',
	[keys.deleteHeading]: '¿Eliminar el documento?',
	[keys.deleted]: 'Documento eliminado',
	[keys.discardBody]: 'Hay cambios sin guardar. Si sales ahora, se descartarán.',
	[keys.discardConfirm]: 'Descartar cambios',
	[keys.discardHeading]: '¿Descartar los cambios?',
	[keys.empty]: 'Aquí todavía no hay nada.',
	[keys.loadFailed]: 'No se pudo cargar. Inténtalo de nuevo.',
	[keys.noResults]: 'Sin coincidencias.',
	[keys.searchPlaceholder]: 'Buscar',
}
