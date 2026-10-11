// Node resolve hook: maps the public website's "@/..." imports to <repo>/src/...
import { statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

const WEBSITE_SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src')

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = resolvePath(WEBSITE_SRC, specifier.slice(2))
    const hit = [base, `${base}.js`, `${base}.mjs`, resolvePath(base, 'index.js')].find(isFile)
    if (hit) return nextResolve(pathToFileURL(hit).href, context)
  }
  return nextResolve(specifier, context)
}
