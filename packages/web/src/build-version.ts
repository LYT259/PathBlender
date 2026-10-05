import { APP_VERSION } from './version-info';

/** Matches the native About panel; never include notes or platform labels. */
export function formatBuildVersion(version: string, hash: string): string {
  return `Version ${version}${hash ? ` (${hash})` : ''}`;
}

export const BUILD_VERSION = formatBuildVersion(APP_VERSION, typeof __PB_GIT_HASH__ === 'string' ? __PB_GIT_HASH__ : '');
