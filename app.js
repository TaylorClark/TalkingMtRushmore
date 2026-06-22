/* Talking Mt Rushmore
 * Point your phone at Mt Rushmore and chat with the presidents.
 * Vanilla JS — no build step. Must be served over HTTPS for camera,
 * geolocation, device orientation and the Web Speech API to work.
 */

(function () {
  'use strict';

  // ---- Config -------------------------------------------------------------

  // GPS coordinates of each presidential face.
  var PRESIDENTS = [
    { name: 'George Washington',   lat: 43.8786554, lng: -103.4597272 },
    { name: 'Thomas Jefferson',    lat: 43.8788183, lng: -103.4597007 },
    { name: 'Theodore Roosevelt',  lat: 43.8790099, lng: -103.4596216 },
    { name: 'Abraham Lincoln',     lat: 43.8790438, lng: -103.4594687 }
  ];

  // Reference point used for the "are you actually here?" proximity check.
  var RUSHMORE_REF = { lat: 43.8771273, lng: -103.4560535 };
  var MAX_DISTANCE_MILES = 1.5;

  var OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  var OPENAI_MODEL = 'gpt-4o-mini';
  var API_KEY_STORAGE = 'openai_api_key';

  // ---- State --------------------------------------------------------------

  var apiKey = null;
  var userLocation = null;       // { lat, lng } from GPS
  var heading = null;            // device compass heading in degrees (0 = North)
  var closestPresident = null;   // president nearest screen center (selection mode)
  var currentPresident = null;   // president we are actively chatting with
  var conversation = [];         // OpenAI chat message history
  var recognition = null;        // SpeechRecognition instance
  var lastTranscript = '';
  var isRecording = false;
  var busy = false;              // true while awaiting an OpenAI reply

  // ---- DOM ----------------------------------------------------------------

  var videoEl = document.getElementById('camera');
  var mainBtn = document.getElementById('mainBtn');
  var changeBtn = document.getElementById('changePresidentBtn');
  var statusLabel = document.getElementById('statusLabel');

  // ---- Helpers ------------------------------------------------------------

  function toRad(deg) { return (deg * Math.PI) / 180; }
  function toDeg(rad) { return (rad * 180) / Math.PI; }

  // Great-circle distance in miles (haversine).
  function distanceMiles(a, b) {
    var R = 3958.8; // Earth radius in miles
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // Initial compass bearing from point a to point b, in degrees (0-360).
  function bearing(a, b) {
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var dLng = toRad(b.lng - a.lng);
    var y = Math.sin(dLng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // Smallest absolute difference between two compass angles (0-180).
  function angleDiff(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function setStatus(text) {
    if (text) {
      statusLabel.textContent = text;
      statusLabel.classList.add('visible');
    } else {
      statusLabel.classList.remove('visible');
    }
  }

  // ---- 1) Camera ----------------------------------------------------------

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera is not supported on this device/browser.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    }).then(function (stream) {
      videoEl.srcObject = stream;
    }).catch(function (err) {
      setStatus('Could not access the camera: ' + err.message);
    });
  }

  // ---- 3) API key + proximity check --------------------------------------

  function initApiKey() {
    apiKey = window.localStorage.getItem(API_KEY_STORAGE);
    if (!apiKey) {
      apiKey = window.prompt('Enter your OpenAI API key to talk with the presidents:');
      if (apiKey) {
        apiKey = apiKey.trim();
        window.localStorage.setItem(API_KEY_STORAGE, apiKey);
      }
    }
  }

  function checkProximity() {
    if (!navigator.geolocation) {
      setStatus('This device does not support location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      var here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      var miles = distanceMiles(here, RUSHMORE_REF);
      if (miles > MAX_DISTANCE_MILES) {
        window.alert('You do not appear to be close to Mt Rushmore so the site will not work.');
      }
    }, function (err) {
      setStatus('Could not get your location: ' + err.message);
    }, { enableHighAccuracy: true, timeout: 15000 });
  }

  // ---- 2) GPS + compass: which face are we looking at? -------------------

  function startLocationTracking() {
    if (!navigator.geolocation) { return; }
    navigator.geolocation.watchPosition(function (pos) {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateClosestPresident();
    }, function () { /* ignore transient errors */ },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }

  function startCompassTracking() {
    function handle(e) {
      // iOS exposes a true compass heading; others use alpha (0 = North,
      // increasing counter-clockwise) so we convert to clockwise heading.
      if (typeof e.webkitCompassHeading === 'number') {
        heading = e.webkitCompassHeading;
      } else if (typeof e.alpha === 'number') {
        heading = (360 - e.alpha) % 360;
      }
      updateClosestPresident();
    }

    // iOS 13+ requires explicit permission, granted from a user gesture.
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      var ask = function () {
        DeviceOrientationEvent.requestPermission().then(function (state) {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', handle, true);
          }
        }).catch(function () {});
        window.removeEventListener('click', ask);
      };
      window.addEventListener('click', ask);
    } else {
      window.addEventListener('deviceorientationabsolute', handle, true);
      window.addEventListener('deviceorientation', handle, true);
    }
  }

  // Pick the face whose bearing from the user best matches the compass heading.
  function updateClosestPresident() {
    if (!userLocation || heading === null) { return; }

    var best = null;
    var bestDiff = Infinity;
    for (var i = 0; i < PRESIDENTS.length; i++) {
      var p = PRESIDENTS[i];
      var diff = angleDiff(heading, bearing(userLocation, p));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    closestPresident = best;

    // Only refresh the selection button when we're not in an active chat.
    if (!currentPresident && closestPresident) {
      mainBtn.textContent = 'Start chat with ' + closestPresident.name;
    }
  }

  // ---- 4 & 5) Start / change president -----------------------------------

  function startChat() {
    if (!closestPresident) { return; }
    if (!apiKey) {
      initApiKey();
      if (!apiKey) { return; }
    }

    currentPresident = closestPresident.name;

    // Begin a fresh chat session seeded with the persona prompt.
    conversation = [
      { role: 'system', content: "answer the user's conversation as if you're " + currentPresident }
    ];

    mainBtn.textContent = 'Tap and hold to say something to ' + currentPresident;
    changeBtn.classList.remove('hidden');
    setStatus('Hold the button and speak to ' + currentPresident + '.');
  }

  function changePresident() {
    currentPresident = null;
    conversation = [];
    changeBtn.classList.add('hidden');
    setStatus('');
    if (closestPresident) {
      mainBtn.textContent = 'Start chat with ' + closestPresident.name;
    } else {
      mainBtn.textContent = 'Looking for a president…';
    }
  }

  // ---- 6) Speech recognition (press and hold) ----------------------------

  function setupRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { return null; }
    var rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = function (event) {
      var transcript = '';
      for (var i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      lastTranscript = transcript.trim();
    };

    rec.onend = function () {
      isRecording = false;
      mainBtn.classList.remove('recording');
      if (lastTranscript) {
        sendToPresident(lastTranscript);
      } else if (currentPresident) {
        setStatus("Didn't catch that — hold the button and try again.");
      }
    };

    rec.onerror = function (e) {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setStatus('Speech recognition error: ' + e.error);
      }
    };

    return rec;
  }

  function beginRecording() {
    if (!currentPresident || busy || isRecording) { return; }
    if (!recognition) {
      setStatus('Speech recognition is not supported on this browser.');
      return;
    }
    lastTranscript = '';
    isRecording = true;
    mainBtn.classList.add('recording');
    setStatus('Listening… release when you are done.');
    try {
      recognition.start();
    } catch (err) {
      // start() throws if called while already running; ignore.
    }
  }

  function endRecording() {
    if (!isRecording) { return; }
    try {
      recognition.stop(); // fires onend, which sends the transcript
    } catch (err) { /* ignore */ }
  }

  // ---- 7) Talk to OpenAI + speak the reply -------------------------------

  function sendToPresident(text) {
    if (!currentPresident) { return; }
    busy = true;
    mainBtn.disabled = true;
    setStatus('waiting for ' + currentPresident + ' to reply…');

    conversation.push({ role: 'user', content: text });

    fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: conversation
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (body) {
          throw new Error('OpenAI request failed (' + res.status + '): ' + body);
        });
      }
      return res.json();
    }).then(function (data) {
      var reply = data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      reply = (reply || '').trim();
      if (!reply) { reply = '(' + currentPresident + ' had nothing to say.)'; }

      conversation.push({ role: 'assistant', content: reply });
      setStatus(reply);
      speak(reply);
    }).catch(function (err) {
      setStatus(err.message);
    }).finally(function () {
      busy = false;
      mainBtn.disabled = false;
      // ---- 8) Reset and stay in the chat loop ----
      if (currentPresident) {
        mainBtn.textContent = 'Tap and hold to say something to ' + currentPresident;
      }
    });
  }

  function speak(text) {
    if (!window.speechSynthesis) { return; }
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }

  // ---- Wiring -------------------------------------------------------------

  function onMainButton() {
    if (!currentPresident) {
      startChat();
    }
    // While chatting the button is driven by press-and-hold, not click.
  }

  function wireEvents() {
    mainBtn.addEventListener('click', onMainButton);
    changeBtn.addEventListener('click', changePresident);

    // Press-and-hold to record (works for both touch and mouse via pointers).
    mainBtn.addEventListener('pointerdown', function (e) {
      if (currentPresident) {
        e.preventDefault();
        beginRecording();
      }
    });
    mainBtn.addEventListener('pointerup', function () {
      if (currentPresident) { endRecording(); }
    });
    mainBtn.addEventListener('pointerleave', function () {
      if (currentPresident) { endRecording(); }
    });
    mainBtn.addEventListener('pointercancel', function () {
      if (currentPresident) { endRecording(); }
    });

    // Stop the page from scrolling/zooming on a long press of the button.
    mainBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // ---- Boot ---------------------------------------------------------------

  function init() {
    startCamera();
    initApiKey();
    checkProximity();
    startLocationTracking();
    startCompassTracking();
    recognition = setupRecognition();
    wireEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
