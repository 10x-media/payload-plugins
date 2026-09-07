import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Panel de ajustes',
	[keys.appearanceLabel]: 'Apariencia',
	[keys.back]: 'Atrás',
	[keys.close]: 'Cerrar',
	[keys.discardBody]: 'Hay cambios sin guardar. Si sales ahora, se descartarán.',
	[keys.discardConfirm]: 'Descartar cambios',
	[keys.discardHeading]: '¿Descartar los cambios?',
	[keys.empty]: 'Aquí todavía no hay nada.',
	[keys.loadFailed]: 'No se pudo cargar. Inténtalo de nuevo.',
	[keys.noResults]: 'Sin coincidencias.',
	[keys.searchPlaceholder]: 'Buscar',
	[keys.widgetNotice]: 'Este widget no se puede mostrar. Puedes quitarlo del panel.',
}
