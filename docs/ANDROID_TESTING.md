# On-device testing: Firefox for Android over Tailscale

Runs the current `dist/` build on a real Android phone as a **temporary debug install**
(`web-ext run`) — nothing is signed or published, per the project rules. Extensions are GA
on **stable** Firefox for Android, so this targets `org.mozilla.firefox` (release), not
Nightly.

## One-time setup

- Mac: `brew install --cask android-platform-tools` (adb), `npm install` (web-ext ≥ 7.12 is
  in devDependencies).
- Phone: install **Firefox** (release) from Play. Enable **Developer options** (Settings →
  About phone → tap Build number 7×), then **Wireless debugging** ON. Phone and Mac must
  both be on the tailnet (`tailscale status`).
- In Firefox on the phone: Settings → About Firefox → tap the logo 5× to unlock the debug
  menu (needed once so `web-ext` can push the temporary add-on).

## Connect (every session)

Wireless debugging runs over the tailnet — no USB, no same-Wi-Fi requirement.

1. Phone: Settings → Developer options → **Wireless debugging**. Note the main
   `IP:PORT` — but use the phone's **Tailscale IP** (e.g. `100.92.139.79`) with that port.
2. First pairing only: tap **Pair device with pairing code**, then on the Mac:

   ```sh
   adb pair 100.92.139.79:PAIRING_PORT   # the dialog's port + 6-digit code (typed at the prompt)
   ```

   The pairing dialog shows a *different* port than the main screen — pair with that one,
   connect with the main one.
3. Connect and verify:

   ```sh
   adb connect 100.92.139.79:MAIN_PORT
   export JOBFILL_ANDROID_DEVICE=100.92.139.79:MAIN_PORT
   npm run android:check        # preflight: prints exact fix-it commands if not ready
   ```

## Launch

```sh
npm run run:android
```

Builds `dist/`, preflights the device, then `web-ext run -t firefox-android
--firefox-apk org.mozilla.firefox --adb-remove-old-artifacts` installs the build as a
temporary add-on and streams reload-on-save. Ctrl-C removes it.

## Console / inspecting

- **about:debugging (best):** desktop Firefox → `about:debugging` → **Setup** → Network
  Location → add `100.92.139.79:MAIN_PORT`… but note web-ext already forwards the debugger:
  while `run:android` is up, the phone appears under about:debugging → your device — inspect
  the extension's background page and content scripts with the full devtools.
- **adb logcat:** `adb -s $JOBFILL_ANDROID_DEVICE logcat --pid=$(adb -s $JOBFILL_ANDROID_DEVICE shell pidof org.mozilla.firefox)`
  for crashes and `console.error` from the extension process.

## Gotchas

- **Disable phone auto-lock while testing** (Settings → Display → Screen timeout → long).
  Remote debugging drops when the phone locks.
- **A phone reboot rotates the wireless-debug port** — re-check the Wireless debugging
  screen, `adb connect` the new port, and update `JOBFILL_ANDROID_DEVICE`. Pairing survives
  reboots; only the port changes.
- Tailscale on the phone must be up (the tailnet IP is how adb reaches it from anywhere).
- If `adb devices` says `unauthorized`, accept the RSA prompt on the phone.
- Never `web-ext sign` / publish — temporary installs only.
