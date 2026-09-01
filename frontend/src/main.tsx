import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ServerWakingBanner from './components/ServerWakingBanner.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerWakingBanner />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
