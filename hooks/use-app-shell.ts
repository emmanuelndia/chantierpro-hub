export function useAppShell(platform: 'web' | 'mobile') {
  return {
    platform,
    isMobile: platform === 'mobile',
    isWeb: platform === 'web',
  };
}
