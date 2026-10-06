import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.back]: 'Retour',
	[keys.done]: 'Terminé',
	[keys.next]: 'Suivant',
	[keys.noVariants]: "Aucun formulaire n'est disponible pour votre compte dans cette collection.",
	[keys.pluginName]: 'Variantes de formulaire',
	[keys.progress]: 'Étapes',
	[keys.readOnly]: 'Ce document est en lecture seule.',
	[keys.stepCompleted]: 'terminée',
	[keys.stepInvalid]: 'Corrigez les champs en surbrillance pour continuer.',
	[keys.switcherLabel]: 'Formulaire',
}
