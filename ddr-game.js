(() => {
  const gameArea = document.getElementById("gameArea");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const comboDisplay = comboEl ? comboEl.parentElement : null;
  const judgementEl = document.getElementById("judgement");
  const statusInstructionEl = document.getElementById("statusInstruction");
  const timeEl = document.getElementById("timeRemaining");
  const shepherdStage = document.getElementById("shepherdStage");
  const startScreen = document.getElementById("startScreen");
  const resultsScreen = document.getElementById("resultsScreen");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const resultsScoreEl = document.getElementById("resultsScore");
  const resultsPerfectEl = document.getElementById("resultsPerfect");
  const resultsGoodEl = document.getElementById("resultsGood");
  const resultsMissEl = document.getElementById("resultsMiss");
  const hitEffects = document.createElement("div");
  hitEffects.className = "hit-particles";

  if (!gameArea || !scoreEl || !judgementEl || !timeEl) {
    return;
  }

  const HIT_Y = 320; // vertical hit position in px inside game area (ideal catch line)
  const GAME_DURATION = 60000; // ms (60 seconds)
  const LANES = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];

  /** Judgement: tight band around HIT_Y for Perfect. */
  const PERFECT_HALF_PX = 16;
  /** Wider valid Good catch band (symmetric around HIT_Y). */
  const GOOD_HALF_PX = 40;
  /**
   * Early input buffer: correct key before Good zone can still catch if heart
   * enters Good within this window (ms). 200ms is within 150–250ms spec.
   */
  const INPUT_BUFFER_MS = 200;

  const STATUS_READY = "Ready — press any arrow key to start";
  const STATUS_GAME_OVER = "Game Over — Press Space to play again";

  const DIFFICULTY = {
    easy:   { noteSpeed: 180, spawnInterval: 900 },
    normal: { noteSpeed: 220, spawnInterval: 700 },
    hard:   { noteSpeed: 260, spawnInterval: 500 },
  };

  let noteSpeed = DIFFICULTY.normal.noteSpeed;
  let spawnInterval = DIFFICULTY.normal.spawnInterval;

  let notes = [];
  let score = 0;
  let combo = 0;
  let perfectCount = 0;
  let goodCount = 0;
  let missCount = 0;
  let lastTime = null;
  let spawnTimer = 0;
  let gameStarted = false;
  let remainingMs = GAME_DURATION;
  let gameOver = false;
  /** Cleared on early restart so results overlay cannot appear after reset. */
  let resultsRevealTimeout = null;
  let shepherdMoodTimeout = null;
  let gameAreaFeedbackTimeout = null;
  const hitLine = gameArea.querySelector(".hit-line");

  /** @type {(null | { expiresAt: number })[]} one optional buffered press per lane */
  let laneInputBuffers = [null, null, null, null];

  gameArea.appendChild(hitEffects);

  function setStatusInstruction(text) {
    if (statusInstructionEl) statusInstructionEl.textContent = text;
  }

  // —— Web Audio (bubbly SFX, no external files) ——
  // Intensity tweaks:
  // - Lane glow: LANE_FLASH_MS (JS), .lane-flash gradient + keyframe opacity (CSS).
  // - Sparkle burst: spawnHitParticles count (JS), .hit-particle size + --sparkle-opacity (CSS).
  // - Game/hit-line glow: box-shadow opacity in @keyframes game-perfect-glow, game-good-glow, hit-line-perfect/good (CSS).
  // - Miss: translate3d px in game-miss-shake, radial-gradient opacity in .game-area::before (CSS).
  // - Audio: env.gain (0.28/0.16/0.12), osc.frequency values, filter.frequency (playJudgementSound below).
  let audioCtx = null;
  let masterGain = null;
  let bgMusic = null;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = (document.getElementById("volumeSlider")?.value ?? 70) / 100;
    masterGain.connect(audioCtx.destination);
  }

  function setMasterVolume(linear) {
    if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, linear));
  }

  function playJudgementSound(type) {
    if (!audioCtx || !masterGain || document.getElementById("muteToggle")?.checked) return;
    const now = audioCtx.currentTime;

    const isPerfect = type === "Perfect";
    const isGood = type === "Good";
    const isMiss = type === "Miss";

    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.5; /* lower Q = softer, less ring */
    osc.connect(filter);
    filter.connect(env);
    env.connect(masterGain);

    if (isPerfect) {
      osc.type = "triangle"; /* brighter, cuter than sine */
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.linearRampToValueAtTime(820, now + 0.022);
      osc.frequency.linearRampToValueAtTime(520, now + 0.07);
      filter.frequency.setValueAtTime(4000, now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.26, now + 0.01);
      env.gain.linearRampToValueAtTime(0, now + 0.078);
      osc.start(now);
      osc.stop(now + 0.078);
    } else if (isGood) {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.linearRampToValueAtTime(620, now + 0.018);
      filter.frequency.setValueAtTime(3200, now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.15, now + 0.008);
      env.gain.linearRampToValueAtTime(0, now + 0.058);
      osc.start(now);
      osc.stop(now + 0.058);
    } else if (isMiss) {
      osc.type = "sine"; /* keep miss soft and round */
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.linearRampToValueAtTime(240, now + 0.06);
      filter.frequency.setValueAtTime(1400, now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.1, now + 0.018);
      env.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  }

  const BGM_PATH = "assets/audio/lofi_nemuko-kawaii-lofi-217666.mp3";
  /** Peak BGM loudness factor; multiplied by volume slider (0–1). Target ~0.25–0.4 effective max. */
  const BGM_LEVEL = 0.32;

  function ensureBgMusic() {
    if (bgMusic) return bgMusic;
    bgMusic = new Audio(BGM_PATH);
    bgMusic.loop = true;
    bgMusic.preload = "auto";
    return bgMusic;
  }

  function syncBgMusicVolumeFromUi() {
    if (!bgMusic) return;
    const muted = document.getElementById("muteToggle")?.checked;
    const pct = parseInt(document.getElementById("volumeSlider")?.value ?? "70", 10) / 100;
    bgMusic.volume = muted ? 0 : Math.min(1, BGM_LEVEL * pct);
  }

  function bgmSessionActive() {
    return (
      startScreen &&
      startScreen.classList.contains("overlay--hidden") &&
      !gameOver
    );
  }

  function startBackgroundMusic() {
    initAudio();
    const el = ensureBgMusic();
    syncBgMusicVolumeFromUi();
    if (document.getElementById("muteToggle")?.checked) {
      el.pause();
      return;
    }
    el.play().catch(() => {});
  }

  function pauseBackgroundMusic() {
    if (!bgMusic) return;
    bgMusic.pause();
  }

  /** Pause and rewind for a new session (Play Again / reset). */
  function stopBackgroundMusicForRound() {
    if (!bgMusic) return;
    bgMusic.pause();
    bgMusic.currentTime = 0;
  }


  function showJudgement(type) {
    judgementEl.textContent = type ? type : "";
    judgementEl.classList.remove("perfect", "good", "miss");
    if (type === "Perfect" || type === "Good" || type === "Miss") {
      judgementEl.classList.add(type.toLowerCase());
    }

    // Trigger shepherd stage reactions
    if (shepherdStage) {
      shepherdStage.classList.remove("shepherd-stage--hype", "shepherd-stage--sad");
      if (shepherdMoodTimeout) {
        clearTimeout(shepherdMoodTimeout);
        shepherdMoodTimeout = null;
      }

      if (type === "Perfect") {
        shepherdStage.classList.add("shepherd-stage--hype");
        shepherdMoodTimeout = setTimeout(() => {
          shepherdStage.classList.remove("shepherd-stage--hype");
        }, 300);
      } else if (type === "Miss") {
        shepherdStage.classList.add("shepherd-stage--sad");
        shepherdMoodTimeout = setTimeout(() => {
          shepherdStage.classList.remove("shepherd-stage--sad");
        }, 500);
      }
    }
  }

  function triggerFeedback(type, laneIndex) {
    if (gameAreaFeedbackTimeout) {
      clearTimeout(gameAreaFeedbackTimeout);
      gameAreaFeedbackTimeout = null;
      gameArea.classList.remove(
        "game-area--perfect-glow",
        "game-area--good-glow",
        "game-area--miss-shake",
        "game-area--miss-tint"
      );
    }

    playJudgementSound(type);

    if (type === "Perfect") {
      gameArea.classList.add("game-area--perfect-glow");
      spawnHitParticles(laneIndex);
      if (hitLine) {
        hitLine.classList.remove("hit-line--perfect", "hit-line--good");
        void hitLine.offsetWidth;
        hitLine.classList.add("hit-line--perfect");
      }
      gameAreaFeedbackTimeout = setTimeout(() => {
        gameArea.classList.remove("game-area--perfect-glow");
        gameAreaFeedbackTimeout = null;
      }, 260);
    } else if (type === "Good") {
      gameArea.classList.add("game-area--good-glow");
      if (hitLine) {
        hitLine.classList.remove("hit-line--perfect", "hit-line--good");
        void hitLine.offsetWidth;
        hitLine.classList.add("hit-line--good");
      }
      gameAreaFeedbackTimeout = setTimeout(() => {
        gameArea.classList.remove("game-area--good-glow");
        gameAreaFeedbackTimeout = null;
      }, 220);
    } else if (type === "Miss") {
      gameArea.classList.add("game-area--miss-shake", "game-area--miss-tint");
      gameAreaFeedbackTimeout = setTimeout(() => {
        gameArea.classList.remove("game-area--miss-shake", "game-area--miss-tint");
        gameAreaFeedbackTimeout = null;
      }, 160);
    }
  }

  function spawnHitParticles(laneIndex) {
    if (!hitEffects) return;
    const count = 5; /* tweak: particle count for PERFECT sparkle burst */
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = `hit-particle lane-${laneIndex}`;
      const dx = (Math.random() - 0.5) * 12;
      const dy = (Math.random() - 0.5) * 8;
      p.style.setProperty("--hit-dx", `${dx}px`);
      p.style.setProperty("--hit-dy", `${dy}px`);
      hitEffects.appendChild(p);
      setTimeout(() => {
        p.remove();
      }, 280);
    }
  }

  function spawnNote() {
    const laneIndex = Math.floor(Math.random() * 4);
    const note = document.createElement("div");
    note.className = `note lane-${laneIndex}`;
    const shadeIndex = Math.floor(Math.random() * 5); // 0–4 for five pink shades
    note.classList.add(`note-shade-${shadeIndex}`);
    gameArea.appendChild(note);

    notes.push({
      el: note,
      lane: laneIndex,
      y: -60,
      hit: false,
    });
  }

  function updateScoreDisplay() {
    scoreEl.textContent = String(score);
  }

  function updateCombo(judgement) {
    if (!comboEl) return;

    if (judgement === "Perfect" || judgement === "Good") {
      combo += 1;
    } else if (judgement === "Miss") {
      combo = 0;
    }

    comboEl.textContent = String(combo);

    if (combo > 0 && comboDisplay && (judgement === "Perfect" || judgement === "Good")) {
      comboDisplay.classList.remove("combo-display--pop");
      // force reflow so animation can retrigger
      void comboDisplay.offsetWidth;
      comboDisplay.classList.add("combo-display--pop");
    }
  }

  function updateTimeDisplay() {
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    timeEl.textContent = String(seconds);
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    gameStarted = false;
    laneInputBuffers = [null, null, null, null];
    showJudgement("");
    setStatusInstruction(STATUS_GAME_OVER);
    pauseBackgroundMusic();
    if (resultsRevealTimeout) {
      clearTimeout(resultsRevealTimeout);
      resultsRevealTimeout = null;
    }
    resultsRevealTimeout = setTimeout(() => {
      resultsRevealTimeout = null;
      if (resultsScoreEl) resultsScoreEl.textContent = String(score);
      if (resultsPerfectEl) resultsPerfectEl.textContent = String(perfectCount);
      if (resultsGoodEl) resultsGoodEl.textContent = String(goodCount);
      if (resultsMissEl) resultsMissEl.textContent = String(missCount);
      if (resultsScreen) resultsScreen.classList.remove("overlay--hidden");
    }, 800);
  }

  function applyActiveDifficultyPreset() {
    const active = document.querySelector(".difficulty-btn--active");
    const diff = active && active.dataset.difficulty ? active.dataset.difficulty : "normal";
    const preset = DIFFICULTY[diff] || DIFFICULTY.normal;
    noteSpeed = preset.noteSpeed;
    spawnInterval = preset.spawnInterval;
  }

  function coreResetState() {
    if (resultsRevealTimeout) {
      clearTimeout(resultsRevealTimeout);
      resultsRevealTimeout = null;
    }
    gameOver = false;
    gameStarted = false;
    score = 0;
    combo = 0;
    perfectCount = 0;
    goodCount = 0;
    missCount = 0;
    remainingMs = GAME_DURATION;
    spawnTimer = 0;
    lastTime = null;
    notes = [];
    laneInputBuffers = [null, null, null, null];
    gameArea.querySelectorAll(".note").forEach((el) => el.remove());
    gameArea.classList.remove(
      "game-area--perfect-glow",
      "game-area--good-glow",
      "game-area--miss-shake",
      "game-area--miss-tint"
    );
    if (comboEl) comboEl.textContent = "0";
    if (comboDisplay) comboDisplay.classList.remove("combo-display--pop");
    if (hitLine) hitLine.classList.remove("hit-line--perfect", "hit-line--good");
    if (shepherdMoodTimeout) {
      clearTimeout(shepherdMoodTimeout);
      shepherdMoodTimeout = null;
    }
    if (gameAreaFeedbackTimeout) {
      clearTimeout(gameAreaFeedbackTimeout);
      gameAreaFeedbackTimeout = null;
    }
    if (shepherdStage) {
      shepherdStage.classList.remove("shepherd-stage--hype", "shepherd-stage--sad");
    }
    stopBackgroundMusicForRound();
  }

  /** After game over: same as first run — board visible, Space not needed again until next time's up. */
  function restartFromGameOver() {
    coreResetState();
    showJudgement("");
    setStatusInstruction(STATUS_READY);
    updateScoreDisplay();
    updateTimeDisplay();
    if (resultsScreen) resultsScreen.classList.add("overlay--hidden");
    if (startScreen) startScreen.classList.add("overlay--hidden");
    initAudio();
    const volSlider = document.getElementById("volumeSlider");
    const mute = document.getElementById("muteToggle")?.checked;
    if (volSlider) setMasterVolume(mute ? 0 : parseInt(volSlider.value, 10) / 100);
    applyActiveDifficultyPreset();
    startBackgroundMusic();
  }

  const LANE_FLASH_MS = 150; /* tweak: lane highlight duration (100–160ms) */

  function flashLane(laneIndex) {
    const flash = document.createElement("div");
    flash.className = `lane-flash lane-${laneIndex}`;
    gameArea.appendChild(flash);
    setTimeout(() => {
      flash.remove();
    }, LANE_FLASH_MS);
  }

  function goodZoneTop() {
    return HIT_Y - GOOD_HALF_PX;
  }

  function goodZoneBottom() {
    return HIT_Y + GOOD_HALF_PX;
  }

  /**
   * Nearest uncaught heart in lane whose center is inside the Good band (inclusive).
   * Hearts above Good top are not caught here (buffer / next frames handle early timing).
   */
  function findCatchableNoteInLane(laneIndex) {
    const top = goodZoneTop();
    const bottom = goodZoneBottom();
    let best = null;
    let bestDist = Infinity;
    for (const note of notes) {
      if (note.lane !== laneIndex || note.hit) continue;
      if (note.y < top || note.y > bottom) continue;
      const d = Math.abs(note.y - HIT_Y);
      if (d < bestDist) {
        bestDist = d;
        best = note;
      }
    }
    return best;
  }

  function judgementForNoteY(noteY) {
    const d = Math.abs(noteY - HIT_Y);
    if (d <= PERFECT_HALF_PX) return "Perfect";
    if (d <= GOOD_HALF_PX) return "Good";
    return "Good";
  }

  function applyCatch(note, laneIndex) {
    const judgement = judgementForNoteY(note.y);
    if (judgement === "Perfect") {
      score += 100;
      perfectCount += 1;
    } else {
      score += 50;
      goodCount += 1;
    }
    note.hit = true;
    note.el.remove();
    notes = notes.filter((n) => n !== note);
    showJudgement(judgement);
    triggerFeedback(judgement, laneIndex);
    updateCombo(judgement);
    updateScoreDisplay();
  }

  /**
   * If a heart in this lane is in the Good catch band now, catch it. Returns true if caught.
   */
  function tryCatchInLane(laneIndex) {
    const note = findCatchableNoteInLane(laneIndex);
    if (!note) return false;
    applyCatch(note, laneIndex);
    return true;
  }

  /**
   * Arrow key: lane flash + optional immediate catch; otherwise store per-lane buffer.
   * Early presses are never an immediate Miss — expiry or uncaught heart past bottom only.
   */
  function onLaneInput(laneIndex) {
    flashLane(laneIndex);
    if (!gameStarted) {
      gameStarted = true;
      setStatusInstruction("");
    }
    if (tryCatchInLane(laneIndex)) {
      laneInputBuffers[laneIndex] = null;
      return;
    }
    laneInputBuffers[laneIndex] = { expiresAt: performance.now() + INPUT_BUFFER_MS };
  }

  /**
   * Resolve buffered inputs after note movement: auto-catch when heart enters Good zone,
   * or Miss when buffer expires with no catch (ghost / too-early tap).
   */
  function updateLaneInputBuffers() {
    const now = performance.now();
    for (let lane = 0; lane < 4; lane++) {
      const buf = laneInputBuffers[lane];
      if (!buf) continue;
      if (tryCatchInLane(lane)) {
        laneInputBuffers[lane] = null;
        continue;
      }
      if (now >= buf.expiresAt) {
        const judgement = "Miss";
        missCount += 1;
        showJudgement(judgement);
        triggerFeedback(judgement, lane);
        updateCombo(judgement);
        updateScoreDisplay();
        laneInputBuffers[lane] = null;
      }
    }
  }

  function update(deltaMs) {
    const deltaSec = deltaMs / 1000;

    if (!gameOver) {
      // Decrease remaining time while game is active
      if (gameStarted) {
        remainingMs -= deltaMs;
        if (remainingMs <= 0) {
          remainingMs = 0;
          updateTimeDisplay();
          endGame();
          return;
        }
        updateTimeDisplay();
      }

      // Move notes
      for (const note of notes) {
        note.y += noteSpeed * deltaSec;
        note.el.style.transform = `translateY(${note.y}px)`;
      }

      // Buffered early taps: catch once heart enters Good zone, or Miss on buffer expiry
      updateLaneInputBuffers();

      // Remove notes that fall past the bottom and count as Miss
      const BOTTOM_LIMIT = 420;
      notes = notes.filter((note) => {
        if (note.y > BOTTOM_LIMIT) {
          if (!note.hit) {
            missCount += 1;
            const judgement = "Miss";
            showJudgement(judgement);
            triggerFeedback(judgement, note.lane);
            updateCombo(judgement);
          }
          note.el.remove();
          return false;
        }
        return true;
      });

      // Spawn notes over time once game has started
      if (gameStarted) {
        spawnTimer += deltaMs;
        if (spawnTimer >= spawnInterval) {
          spawnTimer -= spawnInterval;
          spawnNote();
        }
      }
    }
  }

  function loop(timestamp) {
    if (lastTime == null) {
      lastTime = timestamp;
      requestAnimationFrame(loop);
      return;
    }

    const delta = timestamp - lastTime;
    lastTime = timestamp;

    update(delta);
    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (event) => {
    if (gameOver && event.key === " ") {
      event.preventDefault();
      restartFromGameOver();
      return;
    }

    if (startScreen && !startScreen.classList.contains("overlay--hidden")) {
      event.preventDefault();
      if (event.key === " ") {
        initAudio();
        const volSlider = document.getElementById("volumeSlider");
        const mute = document.getElementById("muteToggle")?.checked;
        if (volSlider) setMasterVolume(mute ? 0 : parseInt(volSlider.value, 10) / 100);
        startBackgroundMusic();
        startScreen.classList.add("overlay--hidden");
        applyActiveDifficultyPreset();
        setStatusInstruction(STATUS_READY);
      }
      return;
    }

    if (gameOver) return;

    const laneIndex = LANES.indexOf(event.key);
    if (laneIndex === -1) return;

    event.preventDefault();
    onLaneInput(laneIndex);
  });

  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", () => {
      restartFromGameOver();
    });
  }

  document.querySelectorAll(".difficulty-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".difficulty-btn").forEach((b) => b.classList.remove("difficulty-btn--active"));
      btn.classList.add("difficulty-btn--active");
    });
  });

  const volumeSlider = document.getElementById("volumeSlider");
  const volumeValueEl = document.getElementById("volumeValue");
  const muteToggle = document.getElementById("muteToggle");
  if (volumeSlider && volumeValueEl) {
    volumeSlider.addEventListener("input", () => {
      initAudio();
      const pct = parseInt(volumeSlider.value, 10);
      if (!muteToggle?.checked) {
        setMasterVolume(pct / 100);
      }
      volumeValueEl.textContent = pct + "%";
      syncBgMusicVolumeFromUi();
    });
  }
  if (muteToggle) {
    muteToggle.addEventListener("change", () => {
      initAudio();
      if (muteToggle.checked) {
        setMasterVolume(0);
        pauseBackgroundMusic();
      } else {
        const pct = parseInt(volumeSlider?.value ?? 70, 10);
        setMasterVolume(pct / 100);
        if (volumeValueEl) volumeValueEl.textContent = pct + "%";
        syncBgMusicVolumeFromUi();
        if (bgmSessionActive()) {
          startBackgroundMusic();
        }
      }
    });
  }

  // Add lane divider visuals (explicit positions)
  const dividerPositions = ["left", "middle", "right"];
  dividerPositions.forEach((pos) => {
    const divider = document.createElement("div");
    divider.className = `lane-divider lane-divider--${pos}`;
    gameArea.appendChild(divider);
  });

  updateScoreDisplay();
  updateTimeDisplay();
  showJudgement("");
  setStatusInstruction(STATUS_READY);
  requestAnimationFrame(loop);
})();

