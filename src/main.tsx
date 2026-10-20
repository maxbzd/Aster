import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/cormorant-garamond/600-italic.css'
import './styles/index.css'
import App from './app/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { bootCloud } from './cloud/boot'
import { initLocale } from './i18n'
import { LocaleRoot } from './i18n/react'
import { installCalm } from './lib/calm'
import { installTickTick } from './ticktick/cycle'

// The cloud connects in the background: the app opens at once and works offline.
void bootCloud()
installCalm()
installTickTick()

// The language (saved choice or the browser's) is resolved before the first render, so nothing flashes in the wrong one.
void initLocale().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LocaleRoot>
        <ErrorBoundary><App /></ErrorBoundary>
      </LocaleRoot>
    </StrictMode>,
  )
})
