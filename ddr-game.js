(() => {
  const gameArea = document.getElementById("gameArea");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const comboDisplay = comboEl ? comboEl.parentElement : null;
  const judgementEl = document.getElementById("judgement");
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

  const HIT_Y = 320; // vertical hit position in px inside game area
  const GAME_DURATION = 60000; // ms (60 seconds)
  const LANES = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];

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
  let shepherdMoodTimeout = null;
  let gameAreaFeedbackTimeout = null;
  const hitLine = gameArea.querySelector(".hit-line");

  gameArea.appendChild(hitEffects);

  // —— Web Audio (bubbly SFX, no external files) ——
  // Intensity tweaks:
  // - Lane glow: LANE_FLASH_MS (JS), .lane-flash gradient + keyframe opacity (CSS).
  // - Sparkle burst: spawnHitParticles count (JS), .hit-particle size + --sparkle-opacity (CSS).
  // - Game/hit-line glow: box-shadow opacity in @keyframes game-perfect-glow, game-good-glow, hit-line-perfect/good (CSS).
  // - Miss: translate3d px in game-miss-shake, radial-gradient opacity in .game-area::before (CSS).
  // - Audio: env.gain (0.28/0.16/0.12), osc.frequency values, filter.frequency (playJudgementSound below).
  let audioCtx = null;
  let masterGain = null;
  let shimmerInterval = null;
  let shimmerBoardwalkInterval = null;
  let shimmerWavyOsc = null;
  let shimmerWavyGain = null;
  let shimmerWavyTimeout = null;
  let shimmerStarryTimeout = null;
  let shimmerActive = false;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = (document.getElementById("volumeSlider")?.value ?? 70) / 100;
    masterGain.connect(audioCtx.destination);
  }

  function getMasterGain() {
    return masterGain ? masterGain.gain.value : 0;
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

  function playBirdChirp() {
    if (!audioCtx || !masterGain) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = "sine";
    const chirpPitches = [2480, 2880, 3240, 2680, 3080, 3560]; /* sunny, happy “tweet” range (Hz) */
    osc.frequency.setValueAtTime(chirpPitches[Math.floor(Math.random() * chirpPitches.length)], now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.012, now + 0.018);
    env.gain.linearRampToValueAtTime(0, now + 0.09);
    osc.connect(env);
    env.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  function playBoardwalkPhrase() {
    if (!audioCtx || !masterGain) return;
    const noteMs = 140;
    const gapMs = 55;
    const stepMs = noteMs + gapMs;
    const phrases = [
      [523, 659, 784, 659],
      [587, 740, 880, 740],
      [523, 659, 880, 659],
      [659, 784, 988, 784]
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    phrase.forEach((freq, i) => {
      const startAt = i * stepMs;
      setTimeout(() => {
        if (!shimmerActive || !audioCtx || !masterGain) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now);
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.022, now + 0.03);
        env.gain.linearRampToValueAtTime(0, now + noteMs / 1000);
        osc.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + noteMs / 1000 + 0.02);
        /* glossy: soft octave-up overtone */
        const hi = audioCtx.createOscillator();
        const hiEnv = audioCtx.createGain();
        hi.type = "sine";
        hi.frequency.setValueAtTime(freq * 2, now);
        hiEnv.gain.setValueAtTime(0, now);
        hiEnv.gain.linearRampToValueAtTime(0.006, now + 0.02);
        hiEnv.gain.linearRampToValueAtTime(0, now + 0.07);
        hi.connect(hiEnv);
        hiEnv.connect(masterGain);
        hi.start(now);
        hi.stop(now + 0.08);
      }, startAt);
    });
  }

  function playStarryPing() {
    if (!audioCtx || !masterGain) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(3400 + Math.random() * 800, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.007, now + 0.012);
    env.gain.linearRampToValueAtTime(0, now + 0.05);
    osc.connect(env);
    env.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  function startWavyPad() {
    if (!audioCtx || !masterGain || shimmerWavyOsc) return;
    shimmerWavyOsc = audioCtx.createOscillator();
    shimmerWavyGain = audioCtx.createGain();
    shimmerWavyOsc.type = "sine";
    shimmerWavyGain.gain.setValueAtTime(0.006, audioCtx.currentTime);
    shimmerWavyOsc.connect(shimmerWavyGain);
    shimmerWavyGain.connect(masterGain);
    shimmerWavyOsc.start(audioCtx.currentTime);
    const wavyFreqs = [360, 500, 420, 560, 400, 480];
    let wavyIndex = 0;
    const scheduleWavyGlide = () => {
      if (!shimmerActive || !shimmerWavyOsc || !audioCtx) return;
      const t = audioCtx.currentTime;
      const nextIndex = (wavyIndex + 1) % wavyFreqs.length;
      const toFreq = wavyFreqs[nextIndex];
      shimmerWavyOsc.frequency.cancelScheduledValues(t);
      shimmerWavyOsc.frequency.setValueAtTime(wavyFreqs[wavyIndex], t);
      shimmerWavyOsc.frequency.linearRampToValueAtTime(toFreq, t + 2.2);
      wavyIndex = nextIndex;
      shimmerWavyTimeout = setTimeout(scheduleWavyGlide, 2300);
    };
    shimmerWavyOsc.frequency.setValueAtTime(wavyFreqs[0], audioCtx.currentTime);
    scheduleWavyGlide();
  }

  function scheduleStarryPing() {
    if (!shimmerActive) return;
    playStarryPing();
    shimmerStarryTimeout = setTimeout(scheduleStarryPing, 2200 + Math.random() * 1600);
  }

  function startShimmer() {
    if (!audioCtx || !masterGain || shimmerActive) return;
    shimmerActive = true;
    const scheduleChirp = () => {
      if (!shimmerActive) return;
      playBirdChirp();
      if (Math.random() < 0.28) {
        setTimeout(() => {
          if (shimmerActive) playBirdChirp();
        }, 90);
      }
      const delay = 2200 + Math.random() * 2000;
      shimmerInterval = setTimeout(scheduleChirp, delay);
    };
    const scheduleBoardwalk = () => {
      if (!shimmerActive) return;
      playBoardwalkPhrase();
      const delay = 2100 + Math.random() * 1400;
      shimmerBoardwalkInterval = setTimeout(scheduleBoardwalk, delay);
    };
    scheduleChirp();
    scheduleBoardwalk();
    startWavyPad();
    scheduleStarryPing();
  }

  function stopShimmer() {
    shimmerActive = false;
    if (shimmerInterval) {
      clearTimeout(shimmerInterval);
      shimmerInterval = null;
    }
    if (shimmerBoardwalkInterval) {
      clearTimeout(shimmerBoardwalkInterval);
      shimmerBoardwalkInterval = null;
    }
    if (shimmerWavyTimeout) {
      clearTimeout(shimmerWavyTimeout);
      shimmerWavyTimeout = null;
    }
    if (shimmerStarryTimeout) {
      clearTimeout(shimmerStarryTimeout);
      shimmerStarryTimeout = null;
    }
    if (shimmerWavyOsc && audioCtx) {
      try {
        shimmerWavyOsc.stop(audioCtx.currentTime + 0.05);
      } catch (_) {}
      shimmerWavyOsc = null;
      shimmerWavyGain = null;
    }
  }


  function showJudgement(type) {
    judgementEl.textContent = type ? type : "";
    judgementEl.classList.remove("perfect", "good", "miss");
    if (type) {
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
    showJudgement("Time's up!");
    stopShimmer();
    setTimeout(() => {
      if (resultsScoreEl) resultsScoreEl.textContent = String(score);
      if (resultsPerfectEl) resultsPerfectEl.textContent = String(perfectCount);
      if (resultsGoodEl) resultsGoodEl.textContent = String(goodCount);
      if (resultsMissEl) resultsMissEl.textContent = String(missCount);
      if (resultsScreen) resultsScreen.classList.remove("overlay--hidden");
    }, 800);
  }

  function resetGame() {
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
    gameArea.querySelectorAll(".note").forEach((el) => el.remove());
    gameArea.classList.remove(
      "game-area--perfect-glow",
      "game-area--good-glow",
      "game-area--miss-shake",
      "game-area--miss-tint"
    );
    showJudgement("");
    updateScoreDisplay();
    updateTimeDisplay();
    if (comboEl) comboEl.textContent = "0";
    if (comboDisplay) comboDisplay.classList.remove("combo-display--pop");
    stopShimmer();
    if (resultsScreen) resultsScreen.classList.add("overlay--hidden");
    if (startScreen) startScreen.classList.remove("overlay--hidden");
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

  function handleHit(laneIndex) {
    flashLane(laneIndex);
    if (!gameStarted) {
      gameStarted = true;
    }

    // Find the closest note in this lane near the hit window
    let bestNote = null;
    let bestDistance = Infinity;
    const PERFECT_WINDOW = 16;
    const GOOD_WINDOW = 32;
    const MAX_WINDOW = 52;

    for (const note of notes) {
      if (note.lane !== laneIndex || note.hit) continue;
      const distance = Math.abs(note.y - HIT_Y);
      if (distance < bestDistance && distance <= MAX_WINDOW) {
        bestDistance = distance;
        bestNote = note;
      }
    }

    if (!bestNote) {
      const judgement = "Miss";
      missCount += 1;
      showJudgement(judgement);
      triggerFeedback(judgement, laneIndex);
      updateCombo(judgement);
      updateScoreDisplay();
      return;
    }

    let judgement;
    if (bestDistance <= PERFECT_WINDOW) {
      judgement = "Perfect";
      score += 100;
      perfectCount += 1;
    } else if (bestDistance <= GOOD_WINDOW) {
      judgement = "Good";
      score += 50;
      goodCount += 1;
    } else {
      judgement = "Miss";
      missCount += 1;
    }

    bestNote.hit = true;
    bestNote.el.remove();
    notes = notes.filter((n) => n !== bestNote);

    showJudgement(judgement);
    triggerFeedback(judgement, laneIndex);
    updateCombo(judgement);
    updateScoreDisplay();
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
    if (startScreen && !startScreen.classList.contains("overlay--hidden")) {
      event.preventDefault();
      if (event.key === " ") {
        initAudio();
        const volSlider = document.getElementById("volumeSlider");
        const mute = document.getElementById("muteToggle")?.checked;
        if (volSlider) setMasterVolume(mute ? 0 : parseInt(volSlider.value, 10) / 100);
        if (document.getElementById("shimmerToggle")?.checked && !mute) startShimmer();
        startScreen.classList.add("overlay--hidden");
        const active = document.querySelector(".difficulty-btn--active");
        const diff = (active && active.dataset.difficulty) ? active.dataset.difficulty : "normal";
        const preset = DIFFICULTY[diff] || DIFFICULTY.normal;
        noteSpeed = preset.noteSpeed;
        spawnInterval = preset.spawnInterval;
      }
      return;
    }

    if (gameOver) return;

    const laneIndex = LANES.indexOf(event.key);
    if (laneIndex === -1) return;

    event.preventDefault();
    handleHit(laneIndex);
  });

  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", () => {
      resetGame();
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
      if (muteToggle?.checked) return;
      const pct = parseInt(volumeSlider.value, 10);
      setMasterVolume(pct / 100);
      volumeValueEl.textContent = pct + "%";
    });
  }
  if (muteToggle) {
    muteToggle.addEventListener("change", () => {
      initAudio();
      if (muteToggle.checked) {
        setMasterVolume(0);
      } else {
        const pct = parseInt(volumeSlider?.value ?? 70, 10);
        setMasterVolume(pct / 100);
        if (volumeValueEl) volumeValueEl.textContent = pct + "%";
      }
    });
  }

  const shimmerToggle = document.getElementById("shimmerToggle");
  if (shimmerToggle) {
    shimmerToggle.addEventListener("change", () => {
      const startHidden = startScreen && startScreen.classList.contains("overlay--hidden");
      const resultsHidden = !resultsScreen || resultsScreen.classList.contains("overlay--hidden");
      if (shimmerToggle.checked && startHidden && resultsHidden && !gameOver) {
        initAudio();
        startShimmer();
      } else {
        stopShimmer();
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
  requestAnimationFrame(loop);
})();

