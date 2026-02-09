import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FinanceDashboard from './finance-dashboard'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FinanceDashboard />
  </StrictMode>,
)
