import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyShareLinkFromLocation, startShareLinkSync } from '@/store/useProjectStore'

// Deep links: ?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5
// Applied before first render; afterwards the URL tracks the design live.
applyShareLinkFromLocation()
startShareLinkSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
