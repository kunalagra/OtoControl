/**
 * What to call the machine running this app in the paired-device list.
 *
 * The vendor app names the current machine "This Mac"; Windows itself calls its
 * current machine "This PC". `navigator.platform` is deprecated but remains the
 * one platform string available without a UA-CH types dependency, and it covers
 * every desktop OS this Web Serial app can run on.
 */
export function machineLabel(platform: string): string {
  const name = platform.toLowerCase();
  if (name.includes('mac')) return 'This Mac';
  if (name.includes('win')) return 'This PC';
  return 'This device';
}
