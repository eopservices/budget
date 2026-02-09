import { useState } from 'react'
import { supabase } from './supabase'

const COLORS = {
  bg: "#0a0f1a",
  card: "#111827",
  border: "#1e293b",
  text: "#e2e8f0",
  textDim: "#64748b",
  accent: "#22d3ee",
  red: "#f87171",
}

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{
        width: '100%', maxWidth: 400, padding: 40,
        background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: COLORS.accent, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
            Eclipse Operation Services
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 700, margin: 0, color: COLORS.text,
            background: 'linear-gradient(135deg, #e2e8f0, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Financial Command Centre
          </h1>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: COLORS.textDim, marginBottom: 6, fontWeight: 500 }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
              style={{
                width: '100%', padding: '12px 14px', background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                borderRadius: 8, color: COLORS.text, fontSize: 14, fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = COLORS.accent}
              onBlur={e => e.target.style.borderColor = COLORS.border}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: COLORS.textDim, marginBottom: 6, fontWeight: 500 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{
                width: '100%', padding: '12px 14px', background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                borderRadius: 8, color: COLORS.text, fontSize: 14, fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = COLORS.accent}
              onBlur={e => e.target.style.borderColor = COLORS.border}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: '#991b1b40', border: `1px solid ${COLORS.red}30`, borderRadius: 8, color: COLORS.red, fontSize: 13 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            padding: '12px 24px', background: loading ? COLORS.textDim : COLORS.accent, border: 'none', borderRadius: 8,
            color: COLORS.bg, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', marginTop: 4, transition: 'background 0.2s',
          }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
