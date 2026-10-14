import type { CapacitorConfig } from '@capacitor/cli'

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
    // Never load http content inside the app. Local development against a
    // laptop's Supabase is allowed only for the emulator's host alias, via
    // android/app/src/debug/res/xml/network_security_config.xml.
    allowMixedContent: false,
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
