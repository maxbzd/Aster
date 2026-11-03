import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/cormorant-garamond/600-italic.css'
import './styles/index.css'
import App from './app/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { VaultGate } from './components/VaultGate'
import { bootCloud } from './cloud/boot'
import { initLocale } from './i18n'
import { LocaleRoot } from './i18n/react'
import { installCalm } from './lib/calm'
import { startUpdates } from './lib/updates'
import { installTickTick } from './ticktick/cycle'

/** Everything that reads or writes the database waits for the vault (if encryption is on) to be open. */
function startServices() {
  // The cloud connects in the background: the app opens at once and works offline.
  void bootCloud()
  installCalm()
  installTickTick()
}

// A new version waits for the person's go-ahead (or the next launch): see lib/updates.ts.
startUpdates()

// The language (saved choice or the browser's) is resolved before the first render, so nothing flashes in the wrong one.
void initLocale().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LocaleRoot>
        <VaultGate onReady={startServices}><ErrorBoundary><App /></ErrorBoundary></VaultGate>
      </LocaleRoot>
    </StrictMode>,
  )
})
