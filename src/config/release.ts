/**
 * Product version and enabled pipeline modules per release.
 * For a new release: duplicate the block, change enabledModuleIds.
 */
export const APP_VERSION = '1.0.0'

export type ReleaseConfig = {
  version: string
  label: string
  enabledModuleIds: readonly string[]
}

export const releases: ReleaseConfig[] = [
  {
    version: '1.0.0',
    label: 'Symbol blur',
    enabledModuleIds: ['vertical-center-squeeze', 'motion-blur'],
  },
  // Example future release without motion blur:
  // {
  //   version: '1.1.0',
  //   label: 'Squeeze only',
  //   enabledModuleIds: ['vertical-center-squeeze'],
  // },
]

/** Active release for deployment */
export const activeRelease =
  releases.find((r) => r.version === APP_VERSION) ?? releases[0]
