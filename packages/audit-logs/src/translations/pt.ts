import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Registos de auditoria',
	// View header
	[keys.title]: 'Registos de auditoria',
	[keys.entries]: '{{count}} entradas',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'Registos de auditoria',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'Selecione um inquilino para ver os registos de auditoria.',

	// Empty state
	[keys.noEntries]: 'Nenhum registo de auditoria encontrado.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} de {{total}}',

	// Debug bar
	[keys.debug]: 'Depuração',
	[keys.queuing]: 'A colocar em fila…',
	[keys.runArchive]: 'Executar arquivamento',
	[keys.runDelete]: 'Executar eliminação',

	// Filter bar
	[keys.filterCollection]: 'Coleção',
	[keys.filterGlobal]: 'Global',
	[keys.filterOperation]: 'Operação',
	[keys.filterTenant]: 'Inquilino',
	[keys.filterUser]: 'Utilizador',
	[keys.filterDocument]: 'Documento',
	[keys.filterEventType]: 'Tipo de evento',
	[keys.filterChangedPath]: 'Caminho alterado',
	[keys.filterGroup]: 'Grupo',
	[keys.groupFilterBtn]: 'Filtrar por grupo',
	[keys.filterDate]: 'Data',
	[keys.filterDateRange]: 'Intervalo de datas',
	[keys.addFilter]: '+ Adicionar filtro',
	[keys.apply]: 'Aplicar',
	[keys.clearAll]: 'Limpar tudo',

	// Editors shared
	[keys.selectPlaceholder]: '— Selecionar —',
	[keys.done]: 'Concluído',

	// Date range editor
	[keys.dateFrom]: 'De',
	[keys.dateTo]: 'Até',
	[keys.startDate]: 'Data inicial…',
	[keys.endDate]: 'Data final…',

	// Single value editor
	[keys.groupPlaceholder]: 'ID do grupo…',
	[keys.orEnterId]: 'ou introduza o ID manualmente',
	[keys.selectCollectionHint]: 'Selecione um filtro de coleção para ativar a pesquisa',
	[keys.documentIdPlaceholder]: 'ID do documento…',
	[keys.update]: 'Atualizar',
	[keys.add]: 'Adicionar',
	[keys.selectEventPlaceholder]: '— Selecionar evento —',
	[keys.eventTypePlaceholder]: 'Tipo de evento…',
	[keys.fieldPathPlaceholder]: 'Caminho do campo…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Selecionar coleção…',
	[keys.userIdPlaceholder]: 'ID do utilizador…',

	// Doc select
	[keys.searchPlaceholder]: 'Pesquisar…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Idioma',
	[keys.sectionSnapshot]: 'Instantâneo',
	[keys.sectionAuthEvent]: 'Evento de autenticação',
	[keys.sectionCustomEvent]: 'Evento personalizado',
	[keys.viewGlobal]: 'Ver global →',
	[keys.viewDocument]: 'Ver documento →',
	[keys.fieldsChanged]: '{{count}} campo',
	[keys.fieldsChangedPlural]: '{{count}} campos',

	// Diff viewer
	[keys.diffPath]: 'Caminho',
	[keys.diffBefore]: 'Antes',
	[keys.diffAfter]: 'Depois',

	// Auth events
	[keys.authEventLogin]: 'Login',
	[keys.authEventForgotPassword]: 'Senha esquecida',
	[keys.authEventFailedLogin]: 'Falha no login',
}
