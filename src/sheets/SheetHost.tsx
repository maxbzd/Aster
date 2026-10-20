import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, type ComponentType } from 'react'
import { useUI } from '@/app/store'

/**
 * Шторки грузятся по требованию — старт приложения легче, — а после первой отрисовки
 * все они подгружаются в фоне (prefetchSheets), поэтому на тапе открываются мгновенно и офлайн.
 */
// шторки получают разные props из стора; точный тип задаётся при открытии в useUI.open
// biome-ignore lint/suspicious/noExplicitAny: у каждой шторки свои props
type SheetComponent = ComponentType<any>

const loaders = {
  person: () => import('./PersonSheet').then(m => ({ default: m.PersonSheet as SheetComponent })),
  log: () => import('./LogSheet').then(m => ({ default: m.LogSheet as SheetComponent })),
  reminder: () => import('./ReminderSheet').then(m => ({ default: m.ReminderSheet as SheetComponent })),
  circles: () => import('./CirclesSheet').then(m => ({ default: m.CirclesSheet as SheetComponent })),
  importVcf: () => import('./ImportSheet').then(m => ({ default: m.ImportSheet as SheetComponent })),
  brief: () => import('./BriefSheet').then(m => ({ default: m.BriefSheet as SheetComponent })),
  draft: () => import('./DraftSheet').then(m => ({ default: m.DraftSheet as SheetComponent })),
  intro: () => import('./IntroSheet').then(m => ({ default: m.IntroSheet as SheetComponent })),
  astra: () => import('./AstraSheet').then(m => ({ default: m.AstraSheet as SheetComponent })),
  cloud: () => import('./CloudSheet').then(m => ({ default: m.CloudSheet as SheetComponent })),
  bridge: () => import('./BridgeSheet').then(m => ({ default: m.BridgeSheet as SheetComponent })),
  ticktick: () => import('./TickTickSheet').then(m => ({ default: m.TickTickSheet as SheetComponent })),
  claude: () => import('./ClaudeSheet').then(m => ({ default: m.ClaudeSheet as SheetComponent })),
  family: () => import('./FamilySheet').then(m => ({ default: m.FamilySheet as SheetComponent })),
  dateEdit: () => import('./DateSheet').then(m => ({ default: m.DateSheet as SheetComponent })),
  prefs: () => import('./PrefsSheet').then(m => ({ default: m.PrefsSheet as SheetComponent })),
  status: () => import('./StatusSheet').then(m => ({ default: m.StatusSheet as SheetComponent })),
  collectionEdit: () => import('./CollectionEditSheet').then(m => ({ default: m.CollectionEditSheet as SheetComponent })),
  collectionPick: () => import('./CollectionPickSheet').then(m => ({ default: m.CollectionPickSheet as SheetComponent })),
  bulk: () => import('./BulkSheet').then(m => ({ default: m.BulkSheet as SheetComponent })),
  dedupe: () => import('./DedupeSheet').then(m => ({ default: m.DedupeSheet as SheetComponent })),
  lead: () => import('./LeadSheet').then(m => ({ default: m.LeadSheet as SheetComponent })),
  leadEdit: () => import('./LeadEditSheet').then(m => ({ default: m.LeadEditSheet as SheetComponent })),
  leadImport: () => import('./LeadImportSheet').then(m => ({ default: m.LeadImportSheet as SheetComponent })),
}
const S = Object.fromEntries(Object.entries(loaders).map(([k, load]) => [k, lazy(load)])) as unknown as Record<keyof typeof loaders, SheetComponent>

export function prefetchSheets() {
  for (const load of Object.values(loaders)) load().catch(() => { /* офлайн: подгрузится позже */ })
}

export function SheetHost() {
  const sheet = useUI(s => s.sheet)
  const close = useUI(s => s.close)
  const key = sheet ? `${sheet.kind}-${'interactionId' in sheet && sheet.interactionId ? sheet.interactionId : 'id' in sheet ? sheet.id : 'personId' in sheet ? sheet.personId : 'aId' in sheet ? sheet.aId + sheet.bId : ''}` : 'none'
  return (
    <AnimatePresence>
      {sheet && (
        <div key={key}>
          <Suspense fallback={null}>
            {sheet.kind === 'addPerson' && <S.person onClose={close} />}
            {sheet.kind === 'editPerson' && <S.person id={sheet.id} onClose={close} />}
            {sheet.kind === 'log' && <S.log personIds={sheet.personIds} type={sheet.type} interactionId={sheet.interactionId} onClose={close} />}
            {sheet.kind === 'reminder' && <S.reminder personId={sheet.personId} text={sheet.text} onClose={close} />}
            {sheet.kind === 'circles' && <S.circles onClose={close} />}
            {sheet.kind === 'importVcf' && <S.importVcf text={sheet.text} onClose={close} />}
            {sheet.kind === 'brief' && <S.brief personId={sheet.personId} onClose={close} />}
            {sheet.kind === 'draft' && <S.draft personId={sheet.personId} occasion={sheet.occasion} onClose={close} />}
            {sheet.kind === 'intro' && <S.intro aId={sheet.aId} bId={sheet.bId} reason={sheet.reason} value={sheet.value} onClose={close} />}
            {sheet.kind === 'astra' && <S.astra onClose={close} />}
            {sheet.kind === 'cloud' && <S.cloud onClose={close} />}
            {sheet.kind === 'ticktick' && <S.ticktick onClose={close} />}
            {sheet.kind === 'claude' && <S.claude onClose={close} />}
            {sheet.kind === 'bridge' && <S.bridge onClose={close} />}
            {sheet.kind === 'family' && <S.family ownerId={sheet.ownerId} id={sheet.id} onClose={close} />}
            {sheet.kind === 'dateEdit' && <S.dateEdit personId={sheet.personId} id={sheet.id} onClose={close} />}
            {sheet.kind === 'prefs' && <S.prefs personId={sheet.personId} onClose={close} />}
            {sheet.kind === 'status' && <S.status personId={sheet.personId} onClose={close} />}
            {sheet.kind === 'collectionEdit' && <S.collectionEdit id={sheet.id} addPersonIds={sheet.addPersonIds} onClose={close} />}
            {sheet.kind === 'collectionPick' && <S.collectionPick personIds={sheet.personIds} onClose={close} />}
            {sheet.kind === 'bulk' && <S.bulk personIds={sheet.personIds} onClose={close} />}
            {sheet.kind === 'dedupe' && <S.dedupe onClose={close} />}
            {sheet.kind === 'lead' && <S.lead id={sheet.id} onClose={close} />}
            {sheet.kind === 'leadEdit' && <S.leadEdit id={sheet.id} smart={sheet.smart} keep={sheet.keep} onClose={close} />}
            {sheet.kind === 'leadImport' && <S.leadImport file={sheet.file} text={sheet.text} onClose={close} />}
          </Suspense>
        </div>
      )}
    </AnimatePresence>
  )
}
