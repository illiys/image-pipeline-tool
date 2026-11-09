import { engine } from './engine'
import type { EngineApi } from './protocol'

declare global {
  interface Window {
    /** Automation API, called by the MCP server (mcp/) through the browser */
    __ssp?: EngineApi
  }
}

window.__ssp = engine
document.body.dataset.ready = 'true'
