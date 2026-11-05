import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/noto-sans-kr'
import './index.css'
import './connection.css'
import App from './App'
import { ConnectionLegalPage } from './components/connection-legal-page'
const legal =
  window.location.pathname === '/privacy' ||
  window.location.pathname === '/data-deletion'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {legal ? (
      <ConnectionLegalPage
        deletion={window.location.pathname === '/data-deletion'}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
