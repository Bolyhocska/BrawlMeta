import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider, useAuth } from './auth.jsx'
import AuthModal from './AuthModal.jsx'
import { Analytics } from '@vercel/analytics/react'

// ANALYTICS. Added 2026-10-09 because this project could measure the draft
// engine's AUC to four decimal places and could not answer "has anyone visited
// the site" at all. Almost every page worth visiting - tier list, maps, draft
// assistant, guides, /news - needs no account and leaves no row in any table,
// so the 3 Profiles rows were never evidence of anything either way.
//
// VERCEL WEB ANALYTICS SPECIFICALLY, and the choice is about consent, not
// convenience. It sets NO COOKIES and does no cross-site tracking, so it needs
// no consent banner under GDPR - where GA4 would have required one, and this
// site deliberately sets no advertising cookies at all. It is also already part
// of the platform we deploy to, so it adds no new processor to the privacy
// policy's sub-processor story and no third-party script from a new origin.
//
// It still COLLECTS, so the privacy policy moved with it (1.3 -> 1.4): that
// page listed "no analytics" as a checked claim, and leaving it would have made
// it false in the one direction LegalPages.jsx's own header calls more
// dangerous than having no policy.
//
// Must ALSO be switched on in the Vercel dashboard (Project -> Analytics).
// The script is inert until then - it loads and reports nothing, which is a
// silent failure, so verify data appears within a day of deploying.

// Single app-wide login modal, driven by auth context so any page can open it.
function GlobalAuthModal() {
  const { authModal, closeAuth } = useAuth();
  return <AuthModal open={!!authModal} initialMode={authModal || 'signin'} onClose={closeAuth} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <GlobalAuthModal />
        <Analytics />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
