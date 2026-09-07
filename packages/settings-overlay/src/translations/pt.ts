import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Painel de definições',
	[keys.appearanceLabel]: 'Aparência',
	[keys.back]: 'Voltar',
	[keys.close]: 'Fechar',
	[keys.delete]: 'Eliminar',
	[keys.deleteBody]: 'Este documento será eliminado permanentemente. Não é possível anular.',
	[keys.deleteConfirm]: 'Eliminar',
	[keys.deleteHeading]: 'Eliminar o documento?',
	[keys.deleted]: 'Documento eliminado',
	[keys.discardBody]: 'Há alterações por guardar. Sair agora descarta-as.',
	[keys.discardConfirm]: 'Descartar alterações',
	[keys.discardHeading]: 'Descartar as alterações?',
	[keys.empty]: 'Ainda não há nada para mostrar aqui.',
	[keys.loadFailed]: 'Não foi possível carregar. Tente novamente.',
	[keys.noResults]: 'Sem correspondências.',
	[keys.searchPlaceholder]: 'Pesquisar',
}
