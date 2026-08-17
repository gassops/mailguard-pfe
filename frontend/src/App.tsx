import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import LoginModal from './components/auth/LoginModal'
import RegisterModal from './components/auth/RegisterModal'
import ApiKeyRevealModal from './components/auth/ApiKeyRevealModal'
import Home from './pages/Home'
import Verify from './pages/Verify'
import Pricing from './pages/Pricing'
import Dashboard from './pages/Dashboard'
import Docs from './pages/Docs'

export default function App() {
  const [loginOpen, setLoginOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [revealKey, setRevealKey] = useState('')

  function openLogin() { setRegisterOpen(false); setLoginOpen(true) }
  function openRegister() { setLoginOpen(false); setRegisterOpen(true) }
  function handleRegisterSuccess(apiKey: string) { setRegisterOpen(false); setRevealKey(apiKey) }

  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <div className="flex flex-col min-h-screen">
            <Navbar onLogin={openLogin} onRegister={openRegister} />
            <main className="flex-1">
              <Routes>
                <Route path="/"          element={<Home onRegister={openRegister} />} />
                <Route path="/verify"    element={<Verify onRegister={openRegister} />} />
                <Route path="/pricing"   element={<Pricing onRegister={openRegister} />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/docs"      element={<Docs />} />
              </Routes>
            </main>
            <Footer />
          </div>

          <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} onSwitchToRegister={openRegister} />
          <RegisterModal isOpen={registerOpen} onClose={() => setRegisterOpen(false)} onSwitchToLogin={openLogin} onSuccess={handleRegisterSuccess} />
          {revealKey && <ApiKeyRevealModal isOpen={!!revealKey} apiKey={revealKey} onClose={() => setRevealKey('')} />}

          <Toaster position="top-right" toastOptions={{ style: { fontSize: '14px' } }} />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
