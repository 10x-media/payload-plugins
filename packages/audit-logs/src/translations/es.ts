import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Registros de auditoría',
	// View header
	[keys.title]: 'Registros de auditoría',
	[keys.entries]: '{{count}} entradas',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'Registros de auditoría',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'Seleccione un inquilino para ver los registros de auditoría.',

	// Empty state
	[keys.noEntries]: 'No se encontraron entradas de auditoría.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} de {{total}}',

	// Debug bar
	[keys.debug]: 'Depuración',
	[keys.queuing]: 'Encolando…',
	[keys.runArchive]: 'Ejecutar archivado',
	[keys.runDelete]: 'Ejecutar eliminación',

	// Filter bar
	[keys.filterCollection]: 'Colección',
	[keys.filterGlobal]: 'Global',
	[keys.filterOperation]: 'Operación',
	[keys.filterTenant]: 'Inquilino',
	[keys.filterUser]: 'Usuario',
	[keys.filterDocument]: 'Documento',
	[keys.filterEventType]: 'Tipo de evento',
	[keys.filterChangedPath]: 'Ruta modificada',
	[keys.filterGroup]: 'Grupo',
	[keys.groupFilterBtn]: 'Filtrar por grupo',
	[keys.filterDate]: 'Fecha',
	[keys.filterDateRange]: 'Rango de fechas',
	[keys.addFilter]: '+ Añadir filtro',
	[keys.apply]: 'Aplicar',
	[keys.clearAll]: 'Borrar todo',

	// Editors shared
	[keys.selectPlaceholder]: '— Seleccionar —',
	[keys.done]: 'Listo',

	// Date range editor
	[keys.dateFrom]: 'Desde',
	[keys.dateTo]: 'Hasta',
	[keys.startDate]: 'Fecha de inicio…',
	[keys.endDate]: 'Fecha de fin…',

	// Single value editor
	[keys.groupPlaceholder]: 'ID de grupo…',
	[keys.orEnterId]: 'o introduzca el ID manualmente',
	[keys.selectCollectionHint]: 'Seleccione un filtro de colección para habilitar la búsqueda',
	[keys.documentIdPlaceholder]: 'ID del documento…',
	[keys.update]: 'Actualizar',
	[keys.add]: 'Añadir',
	[keys.selectEventPlaceholder]: '— Seleccionar evento —',
	[keys.eventTypePlaceholder]: 'Tipo de evento…',
	[keys.fieldPathPlaceholder]: 'Ruta del campo…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Seleccionar colección…',
	[keys.userIdPlaceholder]: 'ID de usuario…',

	// Doc select
	[keys.searchPlaceholder]: 'Buscar…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Idioma',
	[keys.sectionSnapshot]: 'Instantánea',
	[keys.sectionAuthEvent]: 'Evento de autenticación',
	[keys.sectionCustomEvent]: 'Evento personalizado',
	[keys.viewGlobal]: 'Ver global →',
	[keys.viewDocument]: 'Ver documento →',
	[keys.fieldsChanged]: '{{count}} campo',
	[keys.fieldsChangedPlural]: '{{count}} campos',

	// Diff viewer
	[keys.diffPath]: 'Ruta',
	[keys.diffBefore]: 'Antes',
	[keys.diffAfter]: 'Después',

	// Auth events
	[keys.authEventLogin]: 'Inicio de sesión',
	[keys.authEventForgotPassword]: 'Contraseña olvidada',
	[keys.authEventFailedLogin]: 'Inicio de sesión fallido',
}
