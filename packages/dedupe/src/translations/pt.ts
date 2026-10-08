import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Duplicados',
	[keys.queueTitle]: 'Duplicados',
	[keys.collection]: 'Coleção',
	[keys.statusOpen]: 'Abertos',
	[keys.statusDismissed]: 'Não são duplicados',
	[keys.noPairs]: 'Nada para revisar.',
	[keys.noCollections]: 'Nenhuma coleção está configurada para busca de duplicados.',
	[keys.dismiss]: 'Não são duplicados',
	[keys.reopen]: 'Reabrir',
	[keys.mergeInto]: 'Mesclar em {{title}}',
	[keys.runScan]: 'Verificar agora',
	[keys.scanQueued]: 'Verificação enfileirada.',
	[keys.scanDone]: 'Verificação concluída: {{pairs}} pares abertos de {{compared}} comparações.',
	[keys.needsChoice]: 'Precisa de uma escolha',
	[keys.applied]: 'Mesclado no documento principal.',
	[keys.empty]: 'vazio',
	[keys.selectTwo]: 'Selecione de 2 a {{max}} documentos para mesclar.',
	[keys.mergeSelected]: 'Mesclar selecionados',
	[keys.noTransactions]:
		'Este banco de dados não abre transações. Se a mesclagem falhar antes de gravar o principal, os documentos mesclados recuperam seus valores. Se falhar depois, o principal mantém o que foi gravado e os documentos mesclados permanecem, com marcadores no lugar dos valores únicos que cederam. As referências que a aplicação moveu para o principal antes da falha permanecem lá. Uma mesclagem que teria de excluir um documento antes é recusada.',
	[keys.transactionsRequired]:
		'Mesclar está desativado: este banco de dados não abre transações e o plugin exige uma.',
	[keys.takenFrom]: 'Obtido de {{title}}',
	[keys.error]: 'Algo deu errado.',
	[keys.missingParams]:
		'A tela de mesclagem precisa de uma coleção e de dois identificadores de documento.',
	[keys.confirmHeading]: 'Aplicar esta mesclagem?',
	[keys.confirmBody]: '{{absorbed}} será mesclado em {{survivor}} e sairá da coleção.',
	[keys.primary]: 'Principal · mantém o ID',
	[keys.makePrimary]: 'Tornar principal',
	[keys.created]: 'Criado',
	[keys.updated]: 'Atualizado',
	[keys.onlyDifferences]: 'Somente diferenças',
	[keys.showDiff]: 'Destacar diferenças',
	[keys.mergeCount]: 'Mesclar {{count}} documentos',
	[keys.releaseMarked]:
		'{{title}} vai para a lixeira com um marcador em {{fields}}, porque {{survivor}} fica com esses valores e só um documento pode tê-los.',
	[keys.releaseEmptied]:
		'{{title}} vai para a lixeira com {{fields}} vazio, porque {{survivor}} fica com esses valores e só um documento pode tê-los.',
	[keys.pointersCleared]:
		'Os vínculos a documentos desta mesclagem são retirados de {{fields}}: após a mesclagem apontariam para um documento excluído ou para o próprio {{survivor}}.',
	[keys.survivorDraft]:
		'{{title}} tem alterações não publicadas que a mesclagem publicaria. Publique ou descarte-as primeiro.',
	[keys.mayNotApply]: 'Suas permissões não permitem aplicar esta mesclagem.',
	[keys.releaseDeletes]:
		'{{title}} será excluído em vez de ir para a lixeira, porque {{survivor}} fica com seu {{fields}} e só um documento pode ter esses valores.',
	[keys.signals]: 'Por que combinam',
	[keys.takeAll]: 'Manter todos os valores',
	[keys.similarity]: 'Semelhança',
	[keys.whySame]: 'Igual: {{fields}}',
	[keys.whySimilar]: 'Semelhante: {{fields}}',
	[keys.whyDiffer]: 'Diferente: {{fields}}',
	[keys.whyVeto]: 'Descartado por {{fields}}',
	[keys.markedBy]: 'Marcado por',
	[keys.aboutOpen]:
		'Documentos parecidos, uma linha por grupo, aguardando revisão. Abra uma para mesclá-la ou marcá-la como não duplicados.',
	[keys.aboutDismissed]:
		'Documentos marcados como não duplicados, uma linha por grupo. Varreduras posteriores os mantêm aqui; abra uma para reabri-la.',
	[keys.markedNotDuplicates]: 'Marcados como não duplicados.',
	[keys.dismissedNote]: 'Marcados como não duplicados por {{user}} em {{date}}.',
	[keys.markedApart]:
		'{{a}} e {{b}} foram marcados como não duplicados por {{user}} em {{date}}. Mesclá-los desfaz essa marcação.',
	[keys.removeFromMerge]: 'Remover desta mesclagem',
	[keys.removeHeading]: 'Remover {{title}} desta mesclagem?',
	[keys.removeBody]:
		'O documento em si não muda. Os valores escolhidos dele nesta tela são descartados.',
	[keys.andMore]: '{{title}} e mais {{count}}',
	[keys.draftDeleted]: '{{title}} tem alterações não publicadas, que são excluídas com ele.',
}
