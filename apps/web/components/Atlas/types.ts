// Shared Atlas types. They mirror the interfaces of the Enterprise stubs in
// apps/web/ee-stub/components/Atlas so the rest of the app is unchanged.

export interface AtlasPageContext {
  course_uuid?: string
  course_name?: string
  chapter_id?: number
  chapter_name?: string
  activity_uuid?: string
  activity_name?: string
}

export interface AtlasReference {
  type: 'activity' | 'chapter'
  uuid: string
  name: string
  parent_course_uuid: string
  parent_chapter_id?: number
  parent_chapter_name?: string
  activity_type?: string
}

export interface AtlasMiniContextValue {
  available: boolean
  open: boolean
  setOpen: (_open: boolean) => void
  toggle: () => void
  input: string
  setInput: (_v: string) => void
  appendToInput: (_text: string) => void
  focusInput: () => void
  registerInputRef: (_el: HTMLTextAreaElement | null) => void
  pageContext: AtlasPageContext | null
  setPageContext: (_ctx: AtlasPageContext | null) => void
  attachedReferences: AtlasReference[]
  attachReference: (_ref: AtlasReference) => void
  removeReference: (_uuid: string) => void
  clearReferences: () => void
}
