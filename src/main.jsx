import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider, useAuth } from './auth.jsx'
import AuthModal from './AuthModal.jsx'

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
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
