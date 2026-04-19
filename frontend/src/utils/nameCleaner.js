function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function dedupeRepeatedTokens(compact) {
  const tokens = compact.split(' ').filter(Boolean)
  if (tokens.length < 2) return compact

  const normalized = tokens.map(normalizeToken)
  for (let chunkLen = 1; chunkLen <= Math.floor(tokens.length / 2); chunkLen += 1) {
    if (tokens.length % chunkLen !== 0) continue

    const firstNorm = normalized.slice(0, chunkLen)
    let repeated = true
    for (let i = chunkLen; i < normalized.length; i += chunkLen) {
      const current = normalized.slice(i, i + chunkLen)
      if (current.length !== firstNorm.length) {
        repeated = false
        break
      }
      for (let j = 0; j < firstNorm.length; j += 1) {
        if (current[j] !== firstNorm[j]) {
          repeated = false
          break
        }
      }
      if (!repeated) break
    }

    if (repeated) {
      return tokens.slice(0, chunkLen).join(' ')
    }
  }

  return compact
}

function dedupeBySeparator(compact) {
  const separators = [' | ', ' - ', ' / ', ' : ', ' • ']
  for (const separator of separators) {
    if (!compact.includes(separator)) continue

    const parts = compact
      .split(separator)
      .map(part => collapseSpaces(part))
      .filter(Boolean)

    if (parts.length < 2) continue

    const normalizedParts = parts.map(part => part.toLowerCase())
    if (normalizedParts.every(part => part === normalizedParts[0])) {
      return parts[0]
    }
  }

  return compact
}

export function cleanDisplayName(value) {
  const compact = collapseSpaces(value)
  if (!compact) return ''

  const dedupedBySeparator = dedupeBySeparator(compact)
  const dedupedByTokens = dedupeRepeatedTokens(dedupedBySeparator)

  return collapseSpaces(dedupedByTokens)
}
