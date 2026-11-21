import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import './styles.css'
import { App } from './App'

// The last theme used, applied before the first paint; App follows the saved setting from then on.
try {
  if (localStorage.getItem('theme') === 'light') document.documentElement.dataset.theme = 'light'
} catch {
  /* storage unavailable: start dark */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
