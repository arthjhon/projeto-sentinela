import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '2rem', textAlign: 'center'
        }}>
          <div>
            <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>Erro de Configuração</h2>
            <pre style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444',
              borderRadius: '8px', padding: '1rem', color: '#e2e8f0',
              fontSize: '0.875rem', textAlign: 'left', whiteSpace: 'pre-wrap'
            }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
