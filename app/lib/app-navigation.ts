import { Capacitor } from '@capacitor/core';

export function navigateApp(path: string) {
  if (Capacitor.isNativePlatform()) {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else window.location.assign(path);
}
