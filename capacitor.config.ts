import type { CapacitorConfig } from '@capacitor/cli'
import { readFileSync } from 'node:fs'

/**
 * True only when the Android build talks to a laptop's local Supabase through the
 * emulator's host alias. That server speaks plain http, and the WebView (served
 * from https://localhost) blocks http requests as mixed content unless allowed.
 * A build pointed at a real https backend never takes this path.
 */
function usesLocalHttpBackend(): boolean {
  try {
    const env = readFileSync('.env.android.local', 'utf8')
    const url = env.match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1]?.trim() ?? ''
    return /^http:\/\/10\.0\.2\.2[:/]/.test(url)
  } catch {
    return false
  }
}

/**
 * Capacitor wraps the same Vite build that runs on the web.
 *
 * - The app is served from https://localhost inside the WebView, so share links
 *   must use VITE_PUBLIC_APP_URL (the real web address) — nobody else can open
 *   "localhost".
 * - Email confirmation and password-reset links return to the app through the
 *   custom scheme com.medtrace.app://auth/callback, registered in
 *   android/app/src/main/AndroidManifest.xml and in Supabase's redirect URLs.
 */
const config: CapacitorConfig = {
  appId: 'com.medtrace.app',
  appName: 'MedTrace',
  webDir: 'dist',
  android: {
    // Never load http content inside the app, except local development against
    // a laptop's Supabase at the emulator's host alias. Even then, only debug
    // builds may open plain-http connections, and only to 10.0.2.2
    // (android/app/src/debug/res/xml/network_security_config.xml).
    allowMixedContent: usesLocalHttpBackend(),
  },
  plugins: {
    LocalNotifications: {
      // Generic, monochrome; reminders never name a symptom.
      smallIcon: 'ic_stat_medtrace',
      iconColor: '#2E1B2E',
    },
  },
}

export default config
