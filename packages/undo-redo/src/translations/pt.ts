import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.undo]: 'Desfazer',
	[keys.redo]: 'Refazer',
	[keys.debug]: 'Histórico de desfazer',
	[keys.debugTooltip]: 'Inspecionar o histórico de desfazer',
	[keys.debugTitle]: 'Histórico de desfazer',
	[keys.debugEmpty]: 'Ainda não há histórico capturado.',
	[keys.debugClose]: 'Fechar',
	[keys.debugPending]: 'Pendente (não capturado)',
	[keys.debugOriginal]: 'Estado original',
	[keys.debugCopy]: 'Copiar JSON',
}
