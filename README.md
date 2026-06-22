# Talking Mt Rushmore

A single-page web app that lets kids point their phone at Mt Rushmore and have
a spoken conversation with the presidents, powered by AR (live camera + AR-style
overlay) and the OpenAI API.

## How it works

1. The page fills the screen with the rear-facing camera feed.
2. It uses GPS (`navigator.geolocation`) plus the device compass heading to work
   out which presidential face you are pointing at.
3. On first load it asks for your OpenAI API key and stores it in
   `localStorage`. If you are more than 1.5 miles from Mt Rushmore it warns you
   that the site won't work.
4. A button at the bottom reads **"Start chat with [president]"** for whichever
   face is closest to the center of your screen.
5. Tap it to begin a chat session. A small red **"change president"** button
   appears so you can switch faces.
6. Press and hold the main button and speak (Web Speech API). Release to send.
7. Your speech is transcribed and sent to OpenAI. The reply is shown and spoken
   aloud with `speechSynthesis`.
8. Keep holding-to-talk to continue the conversation.

## Running it

Everything that this app uses — camera, geolocation, device orientation and the
Web Speech API — requires a **secure (HTTPS) context**. It will not work from
`file://` or plain `http://` (other than `localhost`).

Quick local test over HTTPS, e.g.:

```bash
# any static server works; for camera/GPS on a phone you need HTTPS + a real host
npx http-server -S -C cert.pem -K key.pem
```

The simplest path is to deploy the three static files (`index.html`,
`style.css`, `app.js`) to any HTTPS static host (GitHub Pages, Netlify, Vercel,
etc.) and open it on a phone.

## Demo mode

Add `?demo` to the URL (e.g. `…/TalkingMtRushmore/?demo`) to test the chat
flow from anywhere — no trip to South Dakota required. Demo mode:

- skips the GPS proximity check (no "you're not near Mt Rushmore" alert), and
- skips compass-based face detection, showing a row of buttons so you can pick
  a president by hand.

Everything else (camera, press-and-hold speech, OpenAI chat, spoken replies)
works exactly as in the live experience.

## Files

- `index.html` — markup and layout
- `style.css` — full-screen camera + bottom controls styling
- `app.js` — camera, GPS/compass face detection, speech, and OpenAI chat

## Notes & caveats

- The OpenAI API key is stored in `localStorage` and calls are made directly
  from the browser. That is fine for a throwaway/kiosk demo but means the key is
  visible to anyone using the device. Don't ship a personal key on a public
  site.
- Compass heading support varies by device. iOS uses `webkitCompassHeading`;
  iOS 13+ also requires a tap to grant motion/orientation permission, which this
  app requests on the first screen tap.
- Speech recognition uses the browser's `SpeechRecognition` API (best support in
  Chrome / Chromium-based browsers).
