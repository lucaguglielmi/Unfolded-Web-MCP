import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {
  applyShareLinkFromLocation,
  loadPersistedProject,
  startProjectPersistence,
  startShareLinkSync,
} from '@/store/useProjectStore'

// Boot order matters: restore the last session first, then let an explicit
// share link (?type=tapered&height=600&...) override it. Afterwards the URL
// tracks the design live and every change is persisted for reloads.
loadPersistedProject()
applyShareLinkFromLocation()
startShareLinkSync()
startProjectPersistence()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
