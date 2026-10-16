/**
 * android-run.mjs — build the current code, install it on the running emulator
 * (or a USB-connected phone) and open it.
 *
 *   npm run android:run
 *
 * Android Studio's Run button packages whatever web build is already in android/,
 * so it can install an old version. This always builds first.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
if (!existsSync(adb)) {
  console.error(`adb not found at ${adb}. Set ANDROID_HOME to your Android SDK folder.`)
  process.exit(1)
}

const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
  .split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim()) || l.includes('\tdevice'))
if (devices.length === 0) {
  console.error('No emulator or phone connected. Start the emulator in Android Studio (Device Manager) first.')
  process.exit(1)
}

const apk = join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
console.log('Installing on', devices[0].split('\t')[0])
execFileSync(adb, ['install', '-r', apk], { stdio: 'inherit' })
execFileSync(adb, ['shell', 'monkey', '-p', 'com.medtrace.app', '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' })
console.log('MedTrace is open on the device.')
