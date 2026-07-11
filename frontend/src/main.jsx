import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initApiBase } from './utils/config'

// Resolve the backend API base (relative in dev, absolute in the EXE) before
// rendering so the first fetches and the audio element target the right host.
initApiBase().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
