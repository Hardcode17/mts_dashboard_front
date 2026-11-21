/** External ITSM route prefix. Without a configured HTTPS origin the demo card stays local. */
export function itsmLink(number: string, key: string, configuredBase?: string) {
  if (configuredBase) {
    try {
      const url = new URL(configuredBase)
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) {
        url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(number)
        return {href: url.href, target: '_blank', rel: 'noopener noreferrer'} as const
      }
    } catch {
      // An invalid deployment setting must not break access to the mock card.
    }
  }
  return {href: '#itsm/' + encodeURIComponent(key)} as const
}
