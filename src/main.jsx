/*sprint 1: react,va importar las herramientas para iniciar y mostrar la aplicación JARVIS*/
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// SPRINT 1: Importación de los estilos generales
import './index.css'

// SPRINT 1: Importación del componente principal
import App from './App.jsx'

// ==========================================
// SPRINT 1: INICIALIZACIÓN DE LA APLICACIÓN
// Busca el elemento root del HTML y renderiza
// el componente principal de JARVIS.
// ==========================================

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
