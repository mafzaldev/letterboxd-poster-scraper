/* ── Letterboxd Movie Picker – frontend logic ───────────────────────────── */
"use strict";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const uploadScreen   = document.getElementById("upload-screen");
const carouselScreen = document.getElementById("carousel-screen");
const csvInput       = document.getElementById("csv-input");
const dropZone       = document.getElementById("drop-zone");
const dropLabel      = document.getElementById("drop-label");
const startBtn       = document.getElementById("start-btn");
const errorMsg       = document.getElementById("error-msg");
const uploadProgress = document.getElementById("upload-progress");
const progressBar    = document.getElementById("progress-bar");
const progressText   = document.getElementById("progress-text");

const backBtn        = document.getElementById("back-btn");
const musicBtn       = document.getElementById("music-btn");
const movieCountLbl  = document.getElementById("movie-count-label");
const carouselTrack  = document.getElementById("carousel-track");
const arrowLeft      = document.getElementById("arrow-left");
const arrowRight     = document.getElementById("arrow-right");
const nowTitle       = document.getElementById("now-title");
const nowYear        = document.getElementById("now-year");
const pickBtn        = document.getElementById("pick-btn");
const winnerOverlay  = document.getElementById("winner-overlay");
const winnerImg      = document.getElementById("winner-img");
const winnerTitle    = document.getElementById("winner-title");
const winnerYear     = document.getElementById("winner-year");
const winnerClose    = document.getElementById("winner-close");

// ── State ────────────────────────────────────────────────────────────────────
let posters          = [];
let currentIndex     = 0;
let visibleCount     = 5;   // recalculated on resize
let isAnimating      = false;
let musicEnabled     = false;
let audioCtx         = null;
let musicNodes       = {};

// ── File selection ────────────────────────────────────────────────────────────
csvInput.addEventListener("change", () => {
  if (csvInput.files[0]) onFileSelected(csvInput.files[0]);
});

dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) onFileSelected(f);
});

function onFileSelected(file) {
  if (!file.name.endsWith(".csv")) {
    showError("Please upload a .csv file from Letterboxd.");
    return;
  }
  dropLabel.innerHTML = `<strong>${file.name}</strong> selected`;
  startBtn.disabled = false;
  hideError();
}

// ── Start button ──────────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  const file = csvInput.files[0];
  if (!file) return;

  startBtn.disabled = true;
  hideError();
  uploadProgress.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "Starting…";

  const formData = new FormData();
  formData.append("watchlist", file);

  try {
    const eventSource = await fetchWithSSE("/api/scrape?stream=1", formData);
    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "progress") {
        const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;
        progressBar.style.width = pct + "%";
        progressText.textContent = `Fetching posters… ${data.done} / ${data.total}`;
      } else if (data.type === "done") {
        eventSource.close();
        progressBar.style.width = "100%";
        progressText.textContent = `Done! Found ${data.posters.length} posters.`;
        setTimeout(() => launchCarousel(data.posters), 600);
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
      showError("Connection error. Please try again.");
      startBtn.disabled = false;
    };
  } catch (err) {
    showError(err.message || "Upload failed.");
    startBtn.disabled = false;
  }
});

/** POST a FormData and return an EventSource-like object via fetch + ReadableStream */
async function fetchWithSSE(url, formData) {
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const j = await response.json().catch(() => ({}));
    throw new Error(j.error || `Server error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Fake EventSource interface
  const fake = { onmessage: null, onerror: null, close: () => { reader.cancel(); } };

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith("data: ") && fake.onmessage) {
            fake.onmessage({ data: line.slice(6) });
          }
        }
      }
    } catch (err) {
      if (fake.onerror) fake.onerror(err);
    }
  })();

  return fake;
}

// ── Carousel ──────────────────────────────────────────────────────────────────
function launchCarousel(data) {
  posters = data;
  currentIndex = 0;

  uploadScreen.classList.remove("active");
  carouselScreen.classList.add("active");

  movieCountLbl.textContent = `${posters.length} movies in your list`;
  buildCarousel();
  updateNowShowing();
  startMusic();
}

function buildCarousel() {
  carouselTrack.innerHTML = "";
  posters.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "poster-card";
    card.dataset.index = i;

    const img = document.createElement("img");
    img.src = p.imageUrl;
    img.alt = p.name;
    img.loading = "lazy";

    const label = document.createElement("div");
    label.className = "card-label";
    label.textContent = p.name;

    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener("click", () => focusCard(i));
    carouselTrack.appendChild(card);
  });

  recalcVisible();
  scrollToIndex(currentIndex, false);
}

function recalcVisible() {
  const w = document.getElementById("carousel-wrapper").clientWidth - 120;
  const cardW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--card-w")) || 180;
  const gap   = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--gap"))    || 20;
  visibleCount = Math.max(1, Math.floor((w + gap) / (cardW + gap)));
}

window.addEventListener("resize", () => {
  recalcVisible();
  scrollToIndex(currentIndex, false);
});

function scrollToIndex(idx, animate = true) {
  const cards = carouselTrack.querySelectorAll(".poster-card");
  if (!cards.length) return;

  // Clamp
  idx = Math.max(0, Math.min(idx, posters.length - 1));
  currentIndex = idx;

  const cardW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--card-w")) || 180;
  const gap   = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--gap"))    || 20;

  // Center current card in the visible strip
  const offset = idx * (cardW + gap) - (visibleCount / 2 - 0.5) * (cardW + gap);
  carouselTrack.style.transition = animate ? "transform .45s cubic-bezier(.4,0,.2,1)" : "none";
  carouselTrack.style.transform  = `translateX(${-Math.max(0, offset)}px)`;

  cards.forEach((c, i) => c.classList.toggle("focused", i === idx));
  updateNowShowing();
}

function focusCard(idx) { scrollToIndex(idx); }

arrowLeft.addEventListener("click",  () => scrollToIndex(currentIndex - 1));
arrowRight.addEventListener("click", () => scrollToIndex(currentIndex + 1));

document.addEventListener("keydown", (e) => {
  if (!carouselScreen.classList.contains("active")) return;
  if (e.key === "ArrowLeft")  scrollToIndex(currentIndex - 1);
  if (e.key === "ArrowRight") scrollToIndex(currentIndex + 1);
});

function updateNowShowing() {
  const p = posters[currentIndex];
  if (!p) return;
  nowTitle.textContent = p.name;
  nowYear.textContent  = p.year ? `(${p.year})` : "";
}

// ── Pick random ───────────────────────────────────────────────────────────────
pickBtn.addEventListener("click", () => {
  if (isAnimating || posters.length === 0) return;
  isAnimating = true;
  pickBtn.disabled = true;

  const target = Math.floor(Math.random() * posters.length);
  let steps = 20 + Math.floor(Math.random() * 15); // 20-35 hops
  let delay = 60;
  let i = 0;

  function hop() {
    const next = (currentIndex + 1) % posters.length;
    scrollToIndex(next);
    i++;
    delay = Math.min(delay * 1.12, 450);
    if (i < steps) {
      setTimeout(hop, delay);
    } else {
      scrollToIndex(target);
      setTimeout(() => showWinner(target), 500);
    }
  }
  hop();
});

function showWinner(idx) {
  const p = posters[idx];
  winnerImg.src          = p.imageUrl;
  winnerImg.alt          = p.name;
  winnerTitle.textContent = p.name;
  winnerYear.textContent  = p.year ? `(${p.year})` : "";
  winnerOverlay.classList.remove("hidden");
  playWinnerSound();
}

winnerClose.addEventListener("click", () => {
  winnerOverlay.classList.add("hidden");
  isAnimating = false;
  pickBtn.disabled = false;
});

// ── Back button ───────────────────────────────────────────────────────────────
backBtn.addEventListener("click", () => {
  carouselScreen.classList.remove("active");
  uploadScreen.classList.add("active");
  stopMusic();
  // Reset upload UI
  csvInput.value = "";
  dropLabel.innerHTML = `Drop your <strong>watchlist.csv</strong> here<br />or click to browse`;
  startBtn.disabled = true;
  uploadProgress.classList.add("hidden");
  progressBar.style.width = "0%";
  winnerOverlay.classList.add("hidden");
  isAnimating = false;
});

// ── Ambient music (Web Audio API synthesizer) ─────────────────────────────────
// A gentle cinematic ambient loop built entirely from oscillators – no audio
// files needed, works offline.
const CHORD_NOTES = [55, 65.41, 73.42, 87.31]; // Am pentatonic (A2 C3 D3 F3)
const MELODY_NOTES = [220, 261.63, 293.66, 349.23, 392, 440, 523.25];

function startMusic() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    musicNodes.master = audioCtx.createGain();
    musicNodes.master.gain.value = 0;
    musicNodes.master.connect(audioCtx.destination);

    // Reverb via convolver
    const convolver = audioCtx.createConvolver();
    const impulse = makeImpulse(audioCtx, 3, 2, false);
    convolver.buffer = impulse;
    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.35;
    convolver.connect(reverbGain);
    reverbGain.connect(musicNodes.master);

    // Pad chords
    CHORD_NOTES.forEach((freq) => {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = audioCtx.createGain();
      g.gain.value = 0.08;
      osc.connect(g);
      g.connect(musicNodes.master);
      g.connect(convolver);
      osc.start();
    });

    // Slow pluck melody
    scheduleMelody();
    musicNodes.melodyTimer = setInterval(scheduleMelody, 8000);

    // Fade in
    musicNodes.master.gain.setTargetAtTime(1, audioCtx.currentTime, 1.5);
    musicEnabled = true;
    updateMusicBtn();
  } catch (err) {
    console.warn("Web Audio API not available – music disabled:", err.message);
    musicBtn.textContent = "🔇 Music (N/A)";
  }
}

function scheduleMelody() {
  if (!audioCtx) return;
  const noteSet = shuffleArray([...MELODY_NOTES]).slice(0, 5);
  noteSet.forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 1.6;
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.12, t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    osc.connect(env);
    env.connect(musicNodes.master);
    osc.start(t);
    osc.stop(t + 1.5);
  });
}

function makeImpulse(ctx, duration, decay, reverse) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const n = reverse ? length - i : i;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }
  }
  return impulse;
}

function stopMusic() {
  if (!audioCtx) return;
  musicNodes.master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.5);
  clearInterval(musicNodes.melodyTimer);
  setTimeout(() => {
    try { audioCtx.close(); } catch (_) {}
    audioCtx = null;
    musicNodes = {};
    musicEnabled = false;
    updateMusicBtn();
  }, 1500);
}

musicBtn.addEventListener("click", () => {
  if (!audioCtx) return;
  musicEnabled = !musicEnabled;
  musicNodes.master.gain.setTargetAtTime(
    musicEnabled ? 1 : 0, audioCtx.currentTime, 0.5
  );
  updateMusicBtn();
});

function updateMusicBtn() {
  musicBtn.textContent = musicEnabled ? "🔊 Music" : "🔇 Music";
  musicBtn.classList.toggle("active", musicEnabled);
}

function playWinnerSound() {
  if (!audioCtx) return;
  const freqs = [523.25, 659.25, 783.99, 1046.5];
  freqs.forEach((f, i) => {
    const t = audioCtx.currentTime + i * 0.12;
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.04);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(env);
    env.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}
function hideError() { errorMsg.classList.add("hidden"); }

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
