import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './ui/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter so the prototype works from a static file open, not just a server. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
