import { isDesktop } from './pref-sync';

export function registerServiceWorker(production: boolean): () => void {
  if (!production || isDesktop || !('serviceWorker' in navigator) || !location.protocol.startsWith('http')) {
    return () => undefined;
  }
  const onLoad = () => {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => {
      /* offline install is a bonus, never fatal */
    });
  };
  window.addEventListener('load', onLoad);
  return () => window.removeEventListener('load', onLoad);
}
