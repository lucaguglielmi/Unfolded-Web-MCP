import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installGlobalFeedback } from '@/lib/feedback'
import { startAgentContinuity } from '@/mcp/agentContinuity'
import { loadPersistedProject, startProjectPersistence } from '@/store/persistence'
import { startLiveSync } from '@/store/syncClient'
import { applyShareLinkFromLocation, startShareLinkSync } from '@/store/urlSync'

// Boot order matters: restore the last session first, then let an explicit
// share link (?type=tapered&height=600&...) override it. Afterwards the URL
// tracks the design live and every change is persisted for reloads. Live
// sync connects last (a paired tab's session state outranks both) and is a
// no-op unless this tab has been paired.
loadPersistedProject()
applyShareLinkFromLocation()
startShareLinkSync()
startProjectPersistence()
startLiveSync()
startAgentContinuity()
installGlobalFeedback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
