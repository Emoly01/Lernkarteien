import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/instrument-sans/latin-700.css'
import '@fontsource/kalam/latin-400.css'
import '@fontsource/kalam/latin-700.css'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
    navigator.serviceWorker.ready.then(reg => {
      const urls = [location.origin + '/', ...performance.getEntriesByType('resource').map(r => r.name)]
      reg.active?.postMessage({ type: 'precache', urls })
    })
  })
}
