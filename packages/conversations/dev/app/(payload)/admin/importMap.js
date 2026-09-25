import { WatchTenantCollection as WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { TenantField as TenantField_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { ChatTrigger as ChatTrigger_63b29dbabe93a0fc3d3dbd1a91acf947 } from '@10x-media/conversations/client'
import { AssignTenantFieldTrigger as AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a } from '@payloadcms/plugin-multi-tenant/client'
import { TicketConversation as TicketConversation_201f579340ded5c1b304baab85f3b757 } from '../../../components/TicketConversation'
import { RscEntryLexicalCell as RscEntryLexicalCell_44fe37237e0ebf4470c9990d8cb7b07e } from '@payloadcms/richtext-lexical/rsc'
import { RscEntryLexicalField as RscEntryLexicalField_44fe37237e0ebf4470c9990d8cb7b07e } from '@payloadcms/richtext-lexical/rsc'
import { LexicalDiffComponent as LexicalDiffComponent_44fe37237e0ebf4470c9990d8cb7b07e } from '@payloadcms/richtext-lexical/rsc'
import { FixedToolbarFeatureClient as FixedToolbarFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { ConversationsMentionFeatureClient as ConversationsMentionFeatureClient_63b29dbabe93a0fc3d3dbd1a91acf947 } from '@10x-media/conversations/client'
import { OrderedListFeatureClient as OrderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { UnorderedListFeatureClient as UnorderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { LinkFeatureClient as LinkFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { BoldFeatureClient as BoldFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { ItalicFeatureClient as ItalicFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { ParagraphFeatureClient as ParagraphFeatureClient_e70f5e05f09f93e00b997edb1ef0c864 } from '@payloadcms/richtext-lexical/client'
import { ChatNavLink as ChatNavLink_cfeefd72d4c98e8e102dfcd2976a7f13 } from '../../../chat/ChatNavLink'
import { PlaygroundNavLink as PlaygroundNavLink_5b5fa18eb8ab6632dd6288f6e303f5b3 } from '../../../playground/PlaygroundNavLink'
import { TenantSelector as TenantSelector_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { TenantSelectionProvider as TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62 } from '@payloadcms/plugin-multi-tenant/rsc'
import { ChatAdminProviderServer as ChatAdminProviderServer_7345af0c80d81d7368c532bb4469972c } from '@10x-media/conversations/rsc'
import { ChatView as ChatView_9ff71714c0033d16c2f4e44b53d7abe9 } from '../../../chat/ChatView'
import { PlaygroundView as PlaygroundView_794a6abe41de858e73edd23cfa8a8229 } from '../../../playground/PlaygroundView'
import { ConversationsSlotDispatcher as ConversationsSlotDispatcher_7345af0c80d81d7368c532bb4469972c } from '@10x-media/conversations/rsc'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { ReactionsBar as ReactionsBar_63b29dbabe93a0fc3d3dbd1a91acf947 } from '@10x-media/conversations/client'
import { ReactionQuickActions as ReactionQuickActions_63b29dbabe93a0fc3d3dbd1a91acf947 } from '@10x-media/conversations/client'
import { StatusChange as StatusChange_31eb553b5a0efb219e39dcd1f84fa727 } from '../../../components/StatusChange'

/** @type import('payload').ImportMap */
export const importMap = {
  "@payloadcms/plugin-multi-tenant/client#WatchTenantCollection": WatchTenantCollection_1d0591e3cf4f332c83a86da13a0de59a,
  "@payloadcms/plugin-multi-tenant/client#TenantField": TenantField_1d0591e3cf4f332c83a86da13a0de59a,
  "@10x-media/conversations/client#ChatTrigger": ChatTrigger_63b29dbabe93a0fc3d3dbd1a91acf947,
  "@payloadcms/plugin-multi-tenant/client#AssignTenantFieldTrigger": AssignTenantFieldTrigger_1d0591e3cf4f332c83a86da13a0de59a,
  "/components/TicketConversation#TicketConversation": TicketConversation_201f579340ded5c1b304baab85f3b757,
  "@payloadcms/richtext-lexical/rsc#RscEntryLexicalCell": RscEntryLexicalCell_44fe37237e0ebf4470c9990d8cb7b07e,
  "@payloadcms/richtext-lexical/rsc#RscEntryLexicalField": RscEntryLexicalField_44fe37237e0ebf4470c9990d8cb7b07e,
  "@payloadcms/richtext-lexical/rsc#LexicalDiffComponent": LexicalDiffComponent_44fe37237e0ebf4470c9990d8cb7b07e,
  "@payloadcms/richtext-lexical/client#FixedToolbarFeatureClient": FixedToolbarFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@10x-media/conversations/client#ConversationsMentionFeatureClient": ConversationsMentionFeatureClient_63b29dbabe93a0fc3d3dbd1a91acf947,
  "@payloadcms/richtext-lexical/client#OrderedListFeatureClient": OrderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#UnorderedListFeatureClient": UnorderedListFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#LinkFeatureClient": LinkFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#BoldFeatureClient": BoldFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#ItalicFeatureClient": ItalicFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "@payloadcms/richtext-lexical/client#ParagraphFeatureClient": ParagraphFeatureClient_e70f5e05f09f93e00b997edb1ef0c864,
  "/chat/ChatNavLink#ChatNavLink": ChatNavLink_cfeefd72d4c98e8e102dfcd2976a7f13,
  "/playground/PlaygroundNavLink#PlaygroundNavLink": PlaygroundNavLink_5b5fa18eb8ab6632dd6288f6e303f5b3,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelector": TenantSelector_d6d5f193a167989e2ee7d14202901e62,
  "@payloadcms/plugin-multi-tenant/rsc#TenantSelectionProvider": TenantSelectionProvider_d6d5f193a167989e2ee7d14202901e62,
  "@10x-media/conversations/rsc#ChatAdminProviderServer": ChatAdminProviderServer_7345af0c80d81d7368c532bb4469972c,
  "/chat/ChatView#ChatView": ChatView_9ff71714c0033d16c2f4e44b53d7abe9,
  "/playground/PlaygroundView#PlaygroundView": PlaygroundView_794a6abe41de858e73edd23cfa8a8229,
  "@10x-media/conversations/rsc#ConversationsSlotDispatcher": ConversationsSlotDispatcher_7345af0c80d81d7368c532bb4469972c,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  "@10x-media/conversations/client#ReactionsBar": ReactionsBar_63b29dbabe93a0fc3d3dbd1a91acf947,
  "@10x-media/conversations/client#ReactionQuickActions": ReactionQuickActions_63b29dbabe93a0fc3d3dbd1a91acf947,
  "/components/StatusChange#StatusChange": StatusChange_31eb553b5a0efb219e39dcd1f84fa727
}
