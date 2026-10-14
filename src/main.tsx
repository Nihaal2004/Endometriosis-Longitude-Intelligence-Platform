import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
// Fonts are bundled rather than loaded from Google Fonts, so the app looks right
// offline and inside the phone app, and no third party sees each app open.
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/fraunces/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import App from './App'
import './ui/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter: works from a static host and from Capacitor's local file serving. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
