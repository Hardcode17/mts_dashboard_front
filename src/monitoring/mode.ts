export function monitorMode() {
  const url = new URL(window.location.href)
  return url.searchParams.get('mode') === 'monitor' || url.hash.split('?')[0] === '#wall'
}
export function watchMonitorMode(listener: () => void) {
  window.addEventListener('hashchange', listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener('hashchange', listener)
    window.removeEventListener('popstate', listener)
  }
}
export function openMonitor(dataset: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('mode', 'monitor')
  url.searchParams.set('dataset', dataset)
  history.pushState(
    {...history.state, mccMonitorFrom: location.pathname + location.search + location.hash},
    '',
    url,
  )
  window.dispatchEvent(new Event('popstate'))
  void document.documentElement.requestFullscreen?.().catch(() => {})
}
export function exitMonitor() {
  const url = new URL(window.location.href)
  url.searchParams.delete('mode')
  if (url.hash.startsWith('#wall') || !url.hash) url.hash = 'overview'
  const {mccMonitorFrom, ...state} = history.state ?? {}
  history.replaceState(
    state,
    '',
    typeof mccMonitorFrom === 'string' && mccMonitorFrom.startsWith('/') && !mccMonitorFrom.startsWith('//')
      ? mccMonitorFrom
      : url,
  )
  window.dispatchEvent(new Event('popstate'))
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}
