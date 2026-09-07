import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Painel de definições',
	[keys.appearanceLabel]: 'Aparência',
	[keys.back]: 'Voltar',
	[keys.close]: 'Fechar',
	[keys.discardBody]: 'Há alterações por guardar. Sair agora descarta-as.',
	[keys.discardConfirm]: 'Descartar alterações',
	[keys.discardHeading]: 'Descartar as alterações?',
	[keys.empty]: 'Ainda não há nada para mostrar aqui.',
	[keys.loadFailed]: 'Não foi possível carregar. Tente novamente.',
	[keys.noResults]: 'Sem correspondências.',
	[keys.searchPlaceholder]: 'Pesquisar',
	[keys.widgetNotice]: 'Este widget não se destina a ser exibido. Você pode removê-lo do painel.',
}
