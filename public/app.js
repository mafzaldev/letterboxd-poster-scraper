/* ── Letterboxd Movie Picker – frontend logic ───────────────────────────── */
"use strict";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const homeScreen      = document.getElementById("home-screen");
const carouselScreen  = document.getElementById("carousel-screen");

const csvInput        = document.getElementById("csv-input");
const dropZone        = document.getElementById("drop-zone");
const dropLabel       = document.getElementById("drop-label");
const startBtn        = document.getElementById("start-btn");
const errorMsg        = document.getElementById("error-msg");
const uploadProgress  = document.getElementById("upload-progress");
const progressBar     = document.getElementById("progress-bar");
const progressText    = document.getElementById("progress-text");

const watchlistsList  = document.getElementById("watchlists-list");
const noWatchlists    = document.getElementById("no-watchlists");

const backBtn         = document.getElementById("back-btn");
const musicBtn        = document.getElementById("music-btn");
const watchlistNameLbl= document.getElementById("watchlist-name-label");
const movieCountLbl   = document.getElementById("movie-count-label");
const posterHeap      = document.getElementById("poster-heap");
const pickBtn         = document.getElementById("pick-btn");
const winnerOverlay   = document.getElementById("winner-overlay");
const winnerImg       = document.getElementById("winner-img");
const winnerTitle     = document.getElementById("winner-title");
const winnerYear      = document.getElementById("winner-year");
const winnerClose     = document.getElementById("winner-close");

// ── State ────────────────────────────────────────────────────────────────────
let posters      = [];
let isAnimating  = false;
let musicEnabled = false;
let audioCtx     = null;
let musicNodes   = {};

// ── Init: load watchlists on page load ───────────────────────────────────────
loadWatchlists();

async function loadWatchlists() {
  try {
    const res = await fetch("/api/watchlists");
    const { watchlists } = await res.json();
    renderWatchlists(watchlists);
  } catch (_) {
    renderWatchlists([]);
  }
}

function renderWatchlists(list) {
  watchlistsList.innerHTML = "";
  if (!list || list.length === 0) {
    noWatchlists.classList.remove("hidden");
    return;
  }
  noWatchlists.classList.add("hidden");

  list.forEach((w) => {
    const item = document.createElement("div");
    item.className = "watchlist-item";
    item.innerHTML = `
      <div class="watchlist-item-name" title="${escHtml(w.name)}">${escHtml(w.name)}</div>
      <div class="watchlist-item-meta">
        ${w.movie_count} movie${w.movie_count !== 1 ? "s" : ""}<br />
        ${formatDate(w.created_at)}
      </div>`;
    item.addEventListener("click", () => openWatchlist(w.id, w.name, w.movie_count));
    watchlistsList.appendChild(item);
  });
}

async function openWatchlist(id, name, count) {
  try {
    const res = await fetch(`/api/watchlists/${id}/posters`);
    const { posters: data } = await res.json();
    launchCarousel(data, name, count);
  } catch (_) {
    alert("Failed to load watchlist.");
  }
}

// ── File selection ────────────────────────────────────────────────────────────
csvInput.addEventListener("change", () => {
  if (csvInput.files[0]) onFileSelected(csvInput.files[0]);
});

dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("drag-over"));
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
  dropLabel.innerHTML = `<strong>${escHtml(file.name)}</strong> selected`;
  startBtn.disabled = false;
  hideError();
}

// ── Upload / scrape ───────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  const file = csvInput.files[0];
  if (!file) return;

  startBtn.disabled = true;
  hideError();
  uploadProgress.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "Starting...";

  const formData = new FormData();
  formData.append("watchlist", file);

  try {
    const source = await fetchWithSSE("/api/scrape?stream=1", formData);
    source.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "progress") {
        const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;
        progressBar.style.width = pct + "%";
        progressText.textContent = `Fetching posters... ${data.done} / ${data.total}`;
      } else if (data.type === "done") {
        source.close();
        progressBar.style.width = "100%";
        progressText.textContent = data.cached
          ? "Loaded from cache."
          : `Done. Found ${data.posters.length} posters.`;
        // Refresh watchlists sidebar, then show carousel
        loadWatchlists();
        setTimeout(() => launchCarousel(data.posters, data.watchlistName, data.posters.length), 500);
      }
    };
    source.onerror = () => {
      source.close();
      showError("Connection error. Please try again.");
      startBtn.disabled = false;
    };
  } catch (err) {
    showError(err.message || "Upload failed.");
    startBtn.disabled = false;
  }
});

/** POST FormData and return a fake EventSource backed by fetch + ReadableStream */
async function fetchWithSSE(url, formData) {
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const j = await response.json().catch(() => ({}));
    throw new Error(j.error || `Server error ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const fake = { onmessage: null, onerror: null, close: () => reader.cancel() };

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

// ── Carousel (multi-row full-page grid) ───────────────────────────────────────
function launchCarousel(data, name, count) {
  posters = data;

  homeScreen.classList.remove("active");
  carouselScreen.classList.add("active");

  watchlistNameLbl.textContent = name || "Watchlist";
  movieCountLbl.textContent = `${count || data.length} movies`;

  buildHeap();
  startMusic();
}

// ── Poster heap ───────────────────────────────────────────────────────────────
function buildHeap() {
  posterHeap.innerHTML = "";
  posters.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "poster-card";
    card.dataset.index = i;

    // Assign random tilt and vertical jitter so cards look like a physical pile
    const rot = (Math.random() * 24) - 12;          // −12 … +12 deg
    const ty  = (Math.random() * 16)  - 8;           // −8  … +8  px
    card.style.setProperty("--rot", `${rot.toFixed(2)}deg`);
    card.style.setProperty("--ty",  `${ty.toFixed(2)}px`);

    const img = document.createElement("img");
    img.src = p.imageUrl;
    img.alt = p.name;
    img.loading = "lazy";

    const label = document.createElement("div");
    label.className = "card-label";
    label.textContent = p.name + (p.year ? ` (${p.year})` : "");

    card.appendChild(img);
    card.appendChild(label);
    posterHeap.appendChild(card);
  });
}

// ── Pick random ───────────────────────────────────────────────────────────────
pickBtn.addEventListener("click", () => {
  if (isAnimating || posters.length === 0) return;
  isAnimating = true;
  pickBtn.disabled = true;

  const cards = Array.from(posterHeap.querySelectorAll(".poster-card"));
  const target = Math.floor(Math.random() * posters.length);
  // Start from a random position so the destination is never guessable
  let current = Math.floor(Math.random() * posters.length);
  let step = 0;
  const steps = 24 + Math.floor(Math.random() * 14); // 24–37 hops
  let delay = 60;

  function focusCard(idx) {
    cards.forEach((c) => c.classList.remove("focused"));
    cards[idx].classList.add("focused");
  }

  function hop() {
    // Jump to a random card – never the same one twice in a row (O(1), no loop)
    let next = Math.floor(Math.random() * (posters.length - 1));
    if (next >= current) next++;
    current = next;
    focusCard(current);

    step++;
    // Ease out: slow down gradually
    delay = Math.min(delay * 1.13, 520);
    if (step < steps) {
      setTimeout(hop, delay);
    } else {
      // Land precisely on the chosen winner, scroll it into view once
      focusCard(target);
      cards[target].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      setTimeout(() => showWinner(target), 700);
    }
  }
  hop();
});

function showWinner(idx) {
  const p = posters[idx];
  winnerImg.src           = p.imageUrl;
  winnerImg.alt           = p.name;
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
  homeScreen.classList.add("active");
  stopMusic();

  // Reset upload UI
  csvInput.value = "";
  dropLabel.innerHTML = `Drop <strong>watchlist.csv</strong> here<br />or click to browse`;
  startBtn.disabled = true;
  uploadProgress.classList.add("hidden");
  progressBar.style.width = "0%";
  winnerOverlay.classList.add("hidden");
  isAnimating = false;

  // Refresh watchlists in case a new one was added
  loadWatchlists();
});

// ── Ambient music (Web Audio API synthesizer) ─────────────────────────────────
const CHORD_NOTES  = [55, 65.41, 73.42, 87.31];
const MELODY_NOTES = [220, 261.63, 293.66, 349.23, 392, 440, 523.25];

function startMusic() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    musicNodes.master = audioCtx.createGain();
    musicNodes.master.gain.value = 0;
    musicNodes.master.connect(audioCtx.destination);

    const convolver = audioCtx.createConvolver();
    convolver.buffer = makeImpulse(audioCtx, 3, 2);
    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.35;
    convolver.connect(reverbGain);
    reverbGain.connect(musicNodes.master);

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

    scheduleMelody();
    musicNodes.melodyTimer = setInterval(scheduleMelody, 8000);
    musicNodes.master.gain.setTargetAtTime(1, audioCtx.currentTime, 1.5);
    musicEnabled = true;
    updateMusicBtn();
  } catch (err) {
    console.warn("Web Audio API not available:", err.message);
    musicBtn.textContent = "Music (N/A)";
  }
}

function scheduleMelody() {
  if (!audioCtx) return;
  shuffleArray([...MELODY_NOTES]).slice(0, 5).forEach((freq, i) => {
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

function makeImpulse(ctx, duration, decay) {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
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
  musicBtn.textContent = musicEnabled ? "Music ON" : "Music OFF";
  musicBtn.classList.toggle("active", musicEnabled);
}

function playWinnerSound() {
  if (!audioCtx) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
