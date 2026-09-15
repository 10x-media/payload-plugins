import type {
	CollectionSlug,
	DataFromCollectionSlug,
	JsonObject,
	JsonValue,
	LabelFunction,
	PayloadComponent,
	PayloadRequest,
	StaticLabel,
	TypedUser,
} from 'payload'

/** A label as Payload's own config writes them. */
export type VariantLabel = LabelFunction | StaticLabel

/**
 * What every server-side function of a variant receives. `doc` is the document being
 * edited, or the initial data on create. `inDrawer` is evaluated for both values on the
 * server and the browser picks the result it is in, since a drawer has no server-side marker.
 */
export type FormVariantsContext = {
	doc: JsonObject | null
	hasPublishedDoc: boolean
	inDrawer: boolean
	operation: 'create' | 'update'
	req: PayloadRequest
	user: TypedUser | null
}

/** Wizard state: a JSON object the steps share. Written by the browser, so never proof of anything. */
export type WizardState = { [key: string]: JsonValue }

/**
 * Step functions additionally see the current form values (this locale only) and the
 * wizard state. Both come from the browser and are untrusted.
 */
export type StepContext = FormVariantsContext & {
	state: WizardState
	values: JsonObject
}

/**
 * What a gate answers when the user leaves a step forwards. `patch.values` replaces the value
 * at each path without deep merging; `patch.state` shallow-merges into wizard state. Both
 * mean "continue" once applied.
 */
export type GateResult =
	| { message: string; result: 'block' }
	| { result: 'continue' }
	| { result: 'patch'; state?: WizardState; values?: JsonObject }

/**
 * What happens after Payload saved the document. `null` keeps Payload's behaviour. `outcome`
 * shows the variant's `Outcome` slot with that data; `switchTo` opens another variant the
 * account can access; `redirect` navigates.
 */
export type AfterSaveAction =
	| { outcome: JsonObject }
	| { redirect: string }
	| { switchTo: string }
	| null

type Primitive = bigint | boolean | Date | null | number | string | symbol | undefined

type Decrement = [never, 0, 1, 2, 3, 4]

/**
 * Dotted data paths of `T`, stopping at arrays and blocks (rows exist only at runtime) and at
 * unions such as a relationship's `string | User`, which are values rather than containers.
 */
export type DataPaths<T, Depth extends number = 4> = Depth extends 0
	? never
	: {
			[K in keyof T & string]: [Exclude<T[K], null | undefined>] extends [
				Primitive | readonly unknown[],
			]
				? K
				: [Exclude<T[K], null | undefined>] extends [object]
					? `${K}.${DataPaths<Exclude<T[K], null | undefined>, Decrement[Depth]>}` | K
					: K
		}[keyof T & string]

/** A field path typed against the collection's generated type. */
export type FieldPath<TSlug extends CollectionSlug> = DataPaths<DataFromCollectionSlug<TSlug>>

/** Presentational overrides a step puts on the field it lists. */
export type FieldItemAdmin = {
	/**
	 * The field's width inside a `row`, as Payload's own `admin.width`: any CSS length, e.g.
	 * `'50%'`. Outside a row it has no effect, as on the native form.
	 */
	width?: string
}

/** A field on a step with presentational overrides. */
export type FieldItemWithOverrides<TSlug extends CollectionSlug> = {
	admin?: FieldItemAdmin
	description?: VariantLabel
	label?: VariantLabel
	path: FieldPath<TSlug>
	/** Optional, since a plain path and a bare string mean the same thing. */
	type?: 'field'
}

/** A non-field component placed between the fields of a step. */
export type ComponentItem = {
	Component: PayloadComponent
	type: 'component'
}

/**
 * Fields laid side by side, as Payload's own `row` does. Width comes from each field's
 * `admin.width`; fields without one share what is left.
 */
export type RowItem<TSlug extends CollectionSlug> = {
	fields: FieldItem<TSlug>[]
	type: 'row'
}

/** Fields behind a collapsible lid, as Payload's own `collapsible` does. */
export type CollapsibleItem<TSlug extends CollectionSlug> = {
	fields: FieldItem<TSlug>[]
	initCollapsed?: boolean
	label: VariantLabel
	type: 'collapsible'
}

/** Fields under a heading and a rule, as Payload's own unnamed `group` does. */
export type GroupItem<TSlug extends CollectionSlug> = {
	description?: VariantLabel
	fields: FieldItem<TSlug>[]
	label?: VariantLabel
	type: 'group'
}

/**
 * One entry in a field step: a field of the collection, a component, or one of the containers
 * a step may draw around them.
 *
 * The containers exist only on the step. They carry no name and touch no data path, exactly as
 * Payload's own `row`, `collapsible` and unnamed `group` do, so the fields inside keep the
 * paths, conditions, validation and custom components they have on the native form. A step can
 * therefore lay out fields that sit far apart in the collection, or in none of its containers
 * at all.
 */
export type FieldItem<TSlug extends CollectionSlug> =
	| CollapsibleItem<TSlug>
	| ComponentItem
	| FieldItemWithOverrides<TSlug>
	| FieldPath<TSlug>
	| GroupItem<TSlug>
	| RowItem<TSlug>

/**
 * Chrome replacements. A slot is a Payload component rendered on the server with
 * serializable props; its live half reads the hooks from `@10x-media/form-variants/client`.
 * `false` hides a part at that level, e.g. `Progress: false` on a one-step variant or
 * `Navigation: false` on a component step that draws its own buttons.
 */
export type SlotComponents = {
	/** Wraps everything a variant renders. Replacing it and building from the hooks is the headless mode. */
	Layout?: PayloadComponent
	/** Back, Next, and Save on the final step. */
	Navigation?: false | PayloadComponent
	/** Shown after `finish(outcome)` or an `outcome` after-save action. */
	Outcome?: PayloadComponent
	/** Step n of m and the step labels. */
	Progress?: false | PayloadComponent
	/** Label and description of the current step. */
	StepHeader?: false | PayloadComponent
	/** Shown when two or more variants are available, including on `native`. */
	VariantSwitcher?: false | PayloadComponent
}

/** The slots a single step may replace or hide. */
export type StepSlotComponents = Pick<SlotComponents, 'Navigation' | 'Progress' | 'StepHeader'>

type StepBase = {
	/** Per-step slot replacements; `false` hides the part on this step. */
	components?: StepSlotComponents
	/** Server-side. A step whose condition fails is skipped and left out of the progress count. */
	condition?: (ctx: StepContext) => boolean | Promise<boolean>
	description?: VariantLabel
	/** Server-side, runs when the user leaves the step forwards. */
	gate?: (ctx: StepContext) => GateResult | Promise<GateResult>
	/** Appears in `?step=` on the full page. */
	key: string
	label?: VariantLabel
}

/** A step drawn from the collection's own fields. */
export type FieldStep<TSlug extends CollectionSlug> = StepBase & {
	Component?: never
	fields: FieldItem<TSlug>[]
}

/** A step rendered by a consumer component with the full wizard API. */
export type ComponentStep = StepBase & {
	Component: PayloadComponent
	fields?: never
}

export type Step<TSlug extends CollectionSlug> = ComponentStep | FieldStep<TSlug>

/**
 * Presentation of a variant's form, everything that is a matter of looks rather than of what
 * the form does. More may land here; today it is how wide the form is and where it sits.
 */
/** Where a variant renders. A drawer has far less room than the page, so options may differ. */
export type Surface = 'drawer' | 'page'

/**
 * An option that may differ by surface. A plain value applies wherever the variant renders; an
 * object names the surfaces it applies to, and any surface it leaves out takes the default.
 */
export type BySurface<T> = Partial<Record<Surface, T>> | T

export type VariantAlign = 'center' | 'left' | 'right'
export type VariantWidth = 'full' | 'half'

/** A variant's presentation. Both options take a surface object as well as a plain value. */
export type VariantUI = {
	/** Where a `half` column sits in the room it has. Ignored at `full` width. Default `left`. */
	align?: BySurface<VariantAlign>
	/**
	 * `full` takes the width Payload's own form takes. `half` is a reading-width column, which
	 * suits a short form and a wizard. Default `full`. A drawer is narrow to begin with, so
	 * `width: { page: 'half' }` is the usual way to ask for the column and leave the drawer alone.
	 */
	width?: BySurface<VariantWidth>
}

/** Which accounts may see a variant. */
export type VariantAccess = (ctx: FormVariantsContext) => boolean | Promise<boolean>

/**
 * Runs after a save that was not an autosave. `savedDoc` is the document as the server reads
 * it after the save (the same as `doc`); `operation` is `create` when the save created it.
 */
export type AfterSaveHook = (
	ctx: FormVariantsContext & { savedDoc: JsonObject }
) => AfterSaveAction | Promise<AfterSaveAction>

/** A variant of the collection's edit form: a sequence of steps over Payload's form state. */
export type Variant<TSlug extends CollectionSlug> = {
	access?: VariantAccess
	afterSave?: AfterSaveHook
	/** Per-variant slot replacements. */
	components?: SlotComponents
	key: string
	label?: VariantLabel
	/**
	 * `free` opens any step directly. `linear` opens the steps behind the current one and the
	 * ones already visited, so looking back at an earlier answer costs one click either way.
	 * Default `linear`.
	 */
	navigation?: 'free' | 'linear'
	/**
	 * When the save guard allows a save, and with it where the save button sits: `final-step`
	 * turns the footer's Next into Save on the last step, `always` keeps Save in the top bar
	 * where Payload puts it. Default `final-step`, or `always` for a variant of a single step,
	 * whose only step is its last one either way.
	 */
	save?: 'always' | 'final-step'
	steps: Step<TSlug>[]
	/** How the form looks: its width and where it sits. */
	ui?: VariantUI
}

/**
 * Payload's own edit view as a variant. It always exists; listing it is how its access is
 * restricted.
 */
export type NativeVariant = {
	access?: VariantAccess
	afterSave?: never
	components?: never
	key: 'native'
	label?: VariantLabel
	navigation?: never
	save?: never
	steps?: never
	ui?: never
}

/** Which variant a document opens with when neither `?variant=` nor a stored choice applies. */
export type DefaultVariant = ((ctx: FormVariantsContext) => Promise<string> | string) | string

/** The form variants of one collection. */
export type FormVariantsConfig<TSlug extends CollectionSlug = CollectionSlug> = {
	/** Slot replacements for every variant of this collection. */
	components?: SlotComponents
	defaultVariant?: DefaultVariant
	/**
	 * The collection this config was written for. `defineFormVariants` sets it, and the plugin
	 * fails at config time when it does not match the collection the config sits on.
	 */
	slug?: TSlug
	variants: (NativeVariant | Variant<TSlug>)[]
}

/** Plugin options: collections the consumer does not own are configured here. */
export type FormVariantsCollections = {
	[K in CollectionSlug]?: FormVariantsConfig<K>
}
