import { describe, expect, it } from 'vitest'
import { visibleNavItems } from './nav'

describe('visibleNavItems', () => {
  it('is Gyms / Inbox / Admin for every platform role', () => {
    const paths = ['/gyms', '/oc/support', '/settings']
    expect(visibleNavItems('platform_support').map((i) => i.path)).toEqual(paths)
    expect(visibleNavItems('platform_sales').map((i) => i.path)).toEqual(paths)
    expect(visibleNavItems('platform_ops').map((i) => i.path)).toEqual(paths)
    expect(visibleNavItems('platform_admin').map((i) => i.path)).toEqual(paths)
  })
})
