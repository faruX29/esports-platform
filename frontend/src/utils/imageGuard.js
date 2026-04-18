import BRANDING from '../branding.config'

const failedImages = new Set()
const guardedImages = new WeakSet()
const pendingFallbackTimers = new WeakMap()
const AVATAR_HINT_REGEX = /(avatar|player|user|profile|face|nick)/i
const EMPTY_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const MIN_BOX_SIZE = 20

function normalizeImageSrc(src) {
  const value = String(src || '').trim()
  if (!value || value.startsWith('data:')) return value
  try {
    return new URL(value, window.location.origin).toString()
  } catch {
    return value
  }
}

function getFallbackForImage(img, originalSrc = '') {
  const hint = [
    img?.alt || '',
    img?.className || '',
    img?.getAttribute?.('data-image-kind') || '',
    originalSrc || '',
  ].join(' ')

  return AVATAR_HINT_REGEX.test(hint)
    ? BRANDING.imageFallbacks.defaultAvatar
    : BRANDING.imageFallbacks.noLogo
}

function getDeclaredSrc(img) {
  if (!img) return ''
  return img.getAttribute('src') || img.currentSrc || ''
}

function lockImageBoxSize(img) {
  if (!(img instanceof HTMLImageElement)) return

  const rect = img.getBoundingClientRect()
  const width = Math.round(rect.width || img.width || 0)
  const height = Math.round(rect.height || img.height || 0)

  if (!img.getAttribute('width') && width >= MIN_BOX_SIZE) {
    img.setAttribute('width', String(width))
  }
  if (!img.getAttribute('height') && height >= MIN_BOX_SIZE) {
    img.setAttribute('height', String(height))
  }
}

function swapToFallback(img, originalSrc) {
  lockImageBoxSize(img)
  img.setAttribute('decoding', 'async')

  const fallbackSrc = getFallbackForImage(img, originalSrc)

  if (img.getAttribute('src') === fallbackSrc || img.currentSrc === fallbackSrc) {
    // Final safety guard: if fallback itself fails, stop retry loops.
    if (img.getAttribute('src') !== EMPTY_PIXEL) {
      img.removeAttribute('srcset')
      img.setAttribute('src', EMPTY_PIXEL)
    }
    return
  }

  img.setAttribute('data-original-src', originalSrc || '')
  img.removeAttribute('srcset')
  img.setAttribute('src', fallbackSrc)
}

function queueFallbackSwap(img, originalSrc) {
  if (!(img instanceof HTMLImageElement)) return
  if (pendingFallbackTimers.has(img)) return

  lockImageBoxSize(img)
  img.setAttribute('decoding', 'async')
  img.setAttribute('data-original-src', originalSrc || '')
  img.removeAttribute('srcset')
  img.setAttribute('src', EMPTY_PIXEL)

  const timerId = window.setTimeout(() => {
    pendingFallbackTimers.delete(img)
    if (!img.isConnected) return
    swapToFallback(img, originalSrc)
  }, 2000)

  pendingFallbackTimers.set(img, timerId)
}

function markImageForGuard(img) {
  if (!(img instanceof HTMLImageElement)) return

  if (!img.getAttribute('decoding')) {
    img.setAttribute('decoding', 'async')
  }

  if (!img.getAttribute('loading')) {
    img.setAttribute('loading', 'lazy')
  }

  const declaredSrc = getDeclaredSrc(img)
  const normalizedDeclaredSrc = normalizeImageSrc(declaredSrc)
  if (declaredSrc && (failedImages.has(declaredSrc) || failedImages.has(normalizedDeclaredSrc))) {
    swapToFallback(img, declaredSrc)
  }

  if (guardedImages.has(img)) return

  img.addEventListener('error', () => {
    const currentSrc = getDeclaredSrc(img)
    const storedOriginalSrc = img.getAttribute('data-original-src') || ''
    const fallbackSrc = getFallbackForImage(img, storedOriginalSrc || currentSrc)
    const originalSrc = storedOriginalSrc || currentSrc
    const normalizedOriginalSrc = normalizeImageSrc(originalSrc)

    const runningTimer = pendingFallbackTimers.get(img)
    if (runningTimer) {
      window.clearTimeout(runningTimer)
      pendingFallbackTimers.delete(img)
    }

    if (currentSrc && normalizeImageSrc(currentSrc) === normalizeImageSrc(fallbackSrc)) {
      failedImages.add(currentSrc)
      const normalizedCurrentSrc = normalizeImageSrc(currentSrc)
      if (normalizedCurrentSrc) failedImages.add(normalizedCurrentSrc)
      img.removeAttribute('srcset')
      img.setAttribute('src', EMPTY_PIXEL)
      return
    }

    if (originalSrc && originalSrc !== EMPTY_PIXEL) {
      failedImages.add(originalSrc)
      if (normalizedOriginalSrc) failedImages.add(normalizedOriginalSrc)
      queueFallbackSwap(img, originalSrc)
      return
    }

    swapToFallback(img, originalSrc)
  })

  guardedImages.add(img)
}

function processNode(node) {
  if (!node) return

  if (node instanceof HTMLImageElement) {
    markImageForGuard(node)
    return
  }

  if (typeof node.querySelectorAll === 'function') {
    node.querySelectorAll('img').forEach(markImageForGuard)
  }
}

export function bootstrapGlobalImageGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  if (window.__lynxImageGuardBooted) return () => {}
  window.__lynxImageGuardBooted = true

  processNode(document)

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(processNode)
      }

      if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
        markImageForGuard(mutation.target)
      }
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  })

  const onErrorCapture = event => {
    if (event.target instanceof HTMLImageElement) {
      markImageForGuard(event.target)
    }
  }

  document.addEventListener('error', onErrorCapture, true)

  return () => {
    observer.disconnect()
    document.removeEventListener('error', onErrorCapture, true)
    window.__lynxImageGuardBooted = false
  }
}

export function getFailedImagesCount() {
  return failedImages.size
}
