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

## The mobile-driven dev loop (what actually worked, 2026-09-06)

The tight loop we ran, phone in hand + laptop driving:

1. **Serve a clean test form over the tailnet** so the *real* extension has a real page to
   act on (the `demo/` pages inject their own harness bundle and would double up — don't test
   the real extension against those). A minimal form lives at
   `docs/examples/android-test-form.html`; serve it bound to the Mac's tailnet IP so the
   phone reaches it directly (no HTTPS needed for a functional smoke; `activeTab` injection
   works on http):

   ```sh
   ( cd docs/examples && python3 -m http.server 5182 --bind $(tailscale ip -4) )
   # phone opens →  http://<mac-tailnet-ip>:5182/android-test-form.html
   ```

2. **Launch the extension:** `npm run run:android` (see above). Leave it running — it
   watches `dist/`, so after a code change just `npm run build` in another shell and web-ext
   hot-reloads the add-on on the phone.

3. **Capture logs while you tap:**

   ```sh
   adb -s $JOBFILL_ANDROID_DEVICE logcat -c            # clear
   adb -s $JOBFILL_ANDROID_DEVICE logcat > /tmp/jf-logcat.log &   # capture
   grep -iE 'jobfill|Gecko.*Error' /tmp/jf-logcat.log  # extension console + errors land here
   ```

4. **Drive the phone by hand, report per step.** Playwright device emulation covers layout
   (`tests/e2e/android.spec.ts`), but touch behaviors that only fail on real hardware —
   clipboard, on-screen keyboard, the OS pairing flow — are found this way. Each real-device
   finding became a test + fix (see PROGRESS.md → "Rung 5 on-device findings").

## Gotchas (learned the hard way)

- **Two different ports.** The "Pair device with pairing code" dialog shows its OWN
  `IP:PORT` (+ a 6-digit code) that is *not* the port on the main Wireless-debugging screen.
  Pair with the dialog's port, then `adb connect` the MAIN port. Pairing to the main port
  fails with `protocol fault (couldn't read status message)`.
- **Firefox's own remote-debugging toggle is separate** from Android's wireless debugging.
  In **Firefox → Settings → Remote debugging via USB → ON** (despite "USB", it's the server
  web-ext needs over the tailnet). Without it, `run:android` sits forever on "Waiting for …
  Remote Debugging Server".
- **`web-ext run` dies when Firefox closes on the phone** ("Exiting the device because
  Firefox for Android disconnected"). Just re-run `npm run run:android` — pairing/adb survive,
  so it reconnects and reinstalls in seconds.
- **Wireless debugging needs Wi-Fi to turn ON.** On a cellular-only phone, bootstrap once
  over USB (`adb tcpip 5555`) then go wireless; documented at the top.
- **Disable phone auto-lock while testing** (Settings → Display → Screen timeout → long).
  Remote debugging + `web-ext run` drop when the phone locks.
- **A phone reboot rotates the wireless-debug port** — re-check the Wireless debugging
  screen, `adb connect` the new port, and update `JOBFILL_ANDROID_DEVICE`. Pairing survives
  reboots; only the port changes.
- Tailscale on the phone must be up (the tailnet IP is how adb reaches it from anywhere).
- If `adb devices` says `unauthorized`, accept the RSA prompt on the phone.
- Never `web-ext sign` / publish — temporary installs only.

## Teardown

```sh
pkill -f 'web-ext run'; pkill -f 'run-android.mjs'   # stop the temp add-on + watcher
pkill -f 'logcat'                                    # stop log capture
adb disconnect                                       # drop the wireless adb link
# (the temporary add-on vanishes on its own when Firefox restarts — nothing is installed)
```
