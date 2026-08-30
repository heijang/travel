import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App'

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl'),
    )
  } catch {
    return false
  }
}

const root = createRoot(document.getElementById('root')!)

if (webglAvailable()) {
  root.render(<StrictMode><App /></StrictMode>)
} else {
  root.render(
    <div className="fallback">
      <h1>This map can't be displayed</h1>
      <p>WebGL isn't available in this browser. Please open the page in a recent version of Chrome, Safari, Firefox, or Edge.</p>
      <p>If hardware acceleration is turned off, you may need to enable it in your browser settings.</p>
    </div>,
  )
}
