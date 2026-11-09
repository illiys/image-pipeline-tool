/**
 * The MCP protocol runs over stdout, so any library logging there would corrupt it.
 * Imported first by server.ts: console output goes to stderr.
 */
console.log = console.error
console.info = console.error
console.debug = console.error
