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
  let shimmerStarryTimeout = null;
  let shimmerBarkInterval = null;
  let shimmerParkPadOscs = [];
  let shimmerParkPadBus = null;
  let shimmerParkPadHp = null;
  let shimmerParkPadPk = null;
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

  /**
   * Small songbird-like syllables: pitch sweeps, 2- and 3-note phrases,
   * sine + faint triangle (more beak / whistle than a pure electronic tone).
   */
  function playBirdChirp() {
    if (!audioCtx || !masterGain) return;
    const now = audioCtx.currentTime;
    const base = 2450 + Math.random() * 1050;

    function birdSyllable(t0, dur, fStart, fEnd, peak) {
      if (dur < 0.018) return;
      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0, t0);
      const atk = Math.min(0.012, dur * 0.25);
      env.gain.linearRampToValueAtTime(peak, t0 + atk);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      env.connect(masterGain);

      const sine = audioCtx.createOscillator();
      sine.type = "sine";
      sine.frequency.setValueAtTime(fStart, t0);
      sine.frequency.linearRampToValueAtTime(fEnd, t0 + dur * 0.92);

      const formant = audioCtx.createOscillator();
      formant.type = "triangle";
      formant.frequency.setValueAtTime(fStart * 1.004, t0);
      formant.frequency.linearRampToValueAtTime(fEnd * 1.004, t0 + dur * 0.92);

      const gS = audioCtx.createGain();
      const gT = audioCtx.createGain();
      gS.gain.value = 0.74;
      gT.gain.value = 0.2;

      sine.connect(gS);
      formant.connect(gT);
      gS.connect(env);
      gT.connect(env);
      sine.start(t0);
      formant.start(t0);
      const stop = t0 + dur + 0.025;
      sine.stop(stop);
      formant.stop(stop);
    }

    const roll = Math.random();
    if (roll < 0.3) {
      /* Single descending whistle */
      birdSyllable(now, 0.078 + Math.random() * 0.02, base * (1.12 + Math.random() * 0.08), base * (0.62 + Math.random() * 0.1), 0.008);
    } else if (roll < 0.58) {
      /* Classic two-part chirp */
      birdSyllable(now, 0.032 + Math.random() * 0.012, base * 1.06, base * (0.94 + Math.random() * 0.06), 0.007);
      birdSyllable(now + 0.04 + Math.random() * 0.018, 0.058 + Math.random() * 0.02, base * (1.1 + Math.random() * 0.06), base * (0.68 + Math.random() * 0.12), 0.0078);
    } else if (roll < 0.78) {
      /* Up-flick then longer answer (phoebe / finch-like) */
      birdSyllable(now, 0.026, base * 0.9, base * 1.08, 0.0065);
      birdSyllable(now + 0.03, 0.055 + Math.random() * 0.02, base * (1.08 + Math.random() * 0.05), base * (0.7 + Math.random() * 0.1), 0.0075);
    } else {
      /* Staccato triple (sparrows) */
      const a = 0.019 + Math.random() * 0.006;
      const b = 0.019 + Math.random() * 0.006;
      birdSyllable(now, a, base * 1.02, base * 0.98, 0.0059);
      birdSyllable(now + a + 0.004, b, base * 1.1, base * 1.04, 0.0059);
      birdSyllable(now + a + b + 0.012, 0.038 + Math.random() * 0.015, base * 1.06, base * (0.74 + Math.random() * 0.08), 0.007);
    }
  }

  /**
   * Small-dog woof: brown-noise breath (less hiss than white), bandpass “vocal” sweep,
   * highpass to clear mud, plus rounded low body — reads clearly as a yap, not a sparkle.
   */
  function playCuteBark() {
    if (!audioCtx || !masterGain) return;
    function oneYip(t0, len, brightness) {
      if (len < 0.03) return;
      const rate = audioCtx.sampleRate;
      const samples = Math.max(960, Math.floor(rate * len));
      const buf = audioCtx.createBuffer(1, samples, rate);
      const d = buf.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < samples; i++) {
        brown = brown * 0.988 + (Math.random() * 2 - 1) * 0.26;
        d[i] = Math.max(-1, Math.min(1, brown));
      }

      const mix = audioCtx.createGain();
      mix.gain.value = 1;
      mix.connect(masterGain);

      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const hp = audioCtx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.setValueAtTime(220, t0);
      hp.Q.value = 0.65;
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      const f0 = 1280 + brightness * 820 + Math.random() * 160;
      const f1 = 580 + brightness * 160 + Math.random() * 70;
      bp.frequency.setValueAtTime(f0, t0);
      bp.frequency.linearRampToValueAtTime(f1, t0 + len * 0.86);
      bp.Q.value = 1.55 + Math.random() * 0.45;

      const nEnv = audioCtx.createGain();
      nEnv.gain.setValueAtTime(0, t0);
      nEnv.gain.linearRampToValueAtTime(0.0068 + Math.random() * 0.0025, t0 + 0.006);
      nEnv.gain.linearRampToValueAtTime(0.005, t0 + len * 0.22);
      nEnv.gain.linearRampToValueAtTime(0.0012, t0 + len * 0.62);
      nEnv.gain.linearRampToValueAtTime(0, t0 + len);

      src.connect(hp);
      hp.connect(bp);
      bp.connect(nEnv);
      nEnv.connect(mix);

      const body = audioCtx.createOscillator();
      body.type = "triangle";
      body.frequency.setValueAtTime(265 + Math.random() * 55, t0);
      body.frequency.linearRampToValueAtTime(145 + Math.random() * 35, t0 + len * 0.82);
      const bEnv = audioCtx.createGain();
      bEnv.gain.setValueAtTime(0, t0);
      bEnv.gain.linearRampToValueAtTime(0.0048 + Math.random() * 0.0012, t0 + 0.014);
      bEnv.gain.linearRampToValueAtTime(0.001, t0 + len * 0.45);
      bEnv.gain.linearRampToValueAtTime(0, t0 + len * 0.98);
      body.connect(bEnv);
      bEnv.connect(mix);

      const ruff = audioCtx.createOscillator();
      ruff.type = "sine";
      ruff.frequency.setValueAtTime(620 + Math.random() * 120, t0);
      ruff.frequency.linearRampToValueAtTime(340 + Math.random() * 80, t0 + len * 0.55);
      const rEnv = audioCtx.createGain();
      rEnv.gain.setValueAtTime(0, t0);
      rEnv.gain.linearRampToValueAtTime(0.0024, t0 + 0.008);
      rEnv.gain.linearRampToValueAtTime(0, t0 + len * 0.42);
      ruff.connect(rEnv);
      rEnv.connect(mix);

      const stopT = t0 + len + 0.035;
      src.start(t0);
      body.start(t0);
      ruff.start(t0);
      src.stop(stopT);
      body.stop(stopT);
      ruff.stop(stopT);
    }

    const now = audioCtx.currentTime;
    const roll = Math.random();
    if (roll < 0.52) {
      oneYip(now, 0.076 + Math.random() * 0.022, 0.88);
    } else if (roll < 0.82) {
      const a = 0.036 + Math.random() * 0.01;
      oneYip(now, a, 0.92);
      oneYip(now + a + 0.08 + Math.random() * 0.04, 0.05 + Math.random() * 0.018, 0.65);
    } else {
      const a = 0.03 + Math.random() * 0.008;
      const b = 0.028 + Math.random() * 0.006;
      oneYip(now, a, 0.95);
      oneYip(now + a + 0.055, b, 0.88);
      oneYip(now + a + b + 0.09, 0.048 + Math.random() * 0.015, 0.55);
    }
  }

  /** D♯maj7 pad — soft chorus + light triangle for bubble / shimmer; slow breath on level. */
  function startSunshineParkPad() {
    if (!audioCtx || !masterGain || shimmerParkPadOscs.length) return;
    const t = audioCtx.currentTime;
    const bus = audioCtx.createGain();
    bus.gain.setValueAtTime(0.00235, t);
    shimmerParkPadBus = bus;

    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 130;
    hp.Q.value = 0.35;
    const pk = audioCtx.createBiquadFilter();
    pk.type = "peaking";
    pk.frequency.value = 2650;
    pk.Q.value = 0.55;
    pk.gain.value = 4.0;
    hp.connect(pk);
    pk.connect(bus);
    bus.connect(masterGain);
    shimmerParkPadHp = hp;
    shimmerParkPadPk = pk;

    /* Very slow swell — keeps the pad from feeling like a static tone. */
    const breath = audioCtx.createOscillator();
    breath.type = "sine";
    breath.frequency.setValueAtTime(0.1, t);
    const breathAmt = audioCtx.createGain();
    breathAmt.gain.value = 0.00038;
    breath.connect(breathAmt);
    breathAmt.connect(bus.gain);
    breath.start(t);
    shimmerParkPadOscs.push(breath);

    /* D♯4, G4, A♯4, D5 — close maj7 (12-TET). */
    const layers = [
      { f: 311.127, w: 0.35 },
      { f: 391.995, w: 0.31 },
      { f: 466.164, w: 0.27 },
      { f: 587.33, w: 0.17 },
    ];
    const human = () => (Math.random() - 0.5) * 1.2;

    layers.forEach(({ f, w }) => {
      const triWeight = f > 520 ? 0.09 : 0.15;
      const voices = [
        { type: "sine", det: 0, frac: 0.45 },
        { type: "sine", det: 7.2, frac: 0.28 },
        { type: "sine", det: -7.2, frac: 0.28 },
        { type: "triangle", det: 2.5, frac: triWeight },
      ];
      voices.forEach(({ type, det, frac }) => {
        const o = audioCtx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        o.detune.setValueAtTime(det + human(), t);
        const g = audioCtx.createGain();
        g.gain.value = w * frac;
        o.connect(g);
        g.connect(hp);
        o.start(t);
        shimmerParkPadOscs.push(o);
      });
    });
  }

  function stopSunshineParkPad() {
    shimmerParkPadOscs.forEach((o) => {
      try {
        o.stop();
      } catch (_) {}
    });
    shimmerParkPadOscs = [];
    if (shimmerParkPadPk) {
      try {
        shimmerParkPadPk.disconnect();
      } catch (_) {}
      shimmerParkPadPk = null;
    }
    if (shimmerParkPadHp) {
      try {
        shimmerParkPadHp.disconnect();
      } catch (_) {}
      shimmerParkPadHp = null;
    }
    if (shimmerParkPadBus) {
      try {
        shimmerParkPadBus.disconnect();
      } catch (_) {}
      shimmerParkPadBus = null;
    }
  }

  /**
   * Bubblegum bells — bright, bouncy, no slow vibrato (that reads “sly”); clean happy pops.
   */
  function playBoardwalkPhrase() {
    if (!audioCtx || !masterGain) return;
    const phrases = [
      [1047, 1175, 1319, 1398],
      [1175, 1319, 1398, 1568],
      [988, 1047, 1175, 1319],
      [1047, 1175, 1245, 1319],
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    let tMs = 0;

    phrase.forEach((freq, i) => {
      const humanMs = (Math.random() - 0.5) * 4;
      const noteLenMs = 118 + Math.random() * 28;
      const gapMs = 44 + Math.random() * 22 + (i % 2 === 0 ? 6 : 0);
      const startAt = Math.max(0, tMs + humanMs);
      tMs = startAt + noteLenMs + gapMs;

      setTimeout(() => {
        if (!shimmerActive || !audioCtx || !masterGain) return;
        const now = audioCtx.currentTime;
        const dur = noteLenMs / 1000;
        const stopT = now + dur + 0.16;
        const centsDrift = (Math.random() - 0.5) * 3;

        const out = audioCtx.createGain();
        out.gain.setValueAtTime(1, now);
        out.connect(masterGain);

        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(5600 + Math.random() * 700, now);
        filter.Q.value = 0.14;

        const bloom = Math.min(0.028, dur * 0.22);
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.detune.setValueAtTime(centsDrift, now);
        osc.frequency.setValueAtTime(freq * 1.004, now);
        osc.frequency.linearRampToValueAtTime(freq, now + bloom);

        const oscB = audioCtx.createOscillator();
        oscB.type = "triangle";
        oscB.detune.setValueAtTime(centsDrift + 12, now);
        oscB.frequency.setValueAtTime(freq * 1.004, now);
        oscB.frequency.linearRampToValueAtTime(freq, now + bloom);

        const gA = audioCtx.createGain();
        const gB = audioCtx.createGain();
        gA.gain.value = 0.72;
        gB.gain.value = 0.14;

        const env = audioCtx.createGain();
        env.gain.setValueAtTime(0, now);
        const peak = 0.0054 + Math.random() * 0.0009;
        env.gain.linearRampToValueAtTime(peak, now + 0.022 + Math.random() * 0.008);
        env.gain.linearRampToValueAtTime(peak * 0.58, now + dur * 0.48);
        env.gain.linearRampToValueAtTime(0, now + dur + 0.16);

        osc.connect(gA);
        oscB.connect(gB);
        gA.connect(filter);
        gB.connect(filter);
        filter.connect(env);
        env.connect(out);

        const h2 = audioCtx.createOscillator();
        h2.type = "sine";
        h2.frequency.setValueAtTime(freq * 2.0, now);
        const e2 = audioCtx.createGain();
        e2.gain.setValueAtTime(0, now);
        e2.gain.linearRampToValueAtTime(0.00115, now + 0.028);
        e2.gain.linearRampToValueAtTime(0, now + dur * 0.5 + 0.05);
        h2.connect(e2);
        e2.connect(out);

        osc.start(now);
        osc.stop(stopT);
        oscB.start(now);
        oscB.stop(stopT);
        h2.start(now);
        h2.stop(stopT);
      }, startAt);
    });
  }

  /** Quick sugary glint — bright, short, fizzy (not a long mysterious tail). */
  function playStarryPing() {
    if (!audioCtx || !masterGain) return;
    const now = audioCtx.currentTime;
    const fairyHz = [2637.02, 2793.83, 3135.96, 3520.0];
    const root = fairyHz[Math.floor(Math.random() * fairyHz.length)];
    const stopT = now + 0.11;

    const air = audioCtx.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.setValueAtTime(7200, now);
    air.Q.value = 0.22;

    const out = audioCtx.createGain();
    out.connect(air);
    air.connect(masterGain);

    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(root, now);

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.0029 + Math.random() * 0.0007, now + 0.011);
    env.gain.linearRampToValueAtTime(0, now + 0.084);
    osc.connect(env);
    env.connect(out);

    const h = audioCtx.createOscillator();
    h.type = "sine";
    h.frequency.setValueAtTime(root * 2, now);
    const he = audioCtx.createGain();
    he.gain.setValueAtTime(0, now);
    he.gain.linearRampToValueAtTime(0.00055, now + 0.018);
    he.gain.linearRampToValueAtTime(0, now + 0.065);
    h.connect(he);
    he.connect(out);

    osc.start(now);
    osc.stop(stopT);
    h.start(now);
    h.stop(stopT);
  }

  function scheduleStarryPing() {
    if (!shimmerActive) return;
    playStarryPing();
    shimmerStarryTimeout = setTimeout(scheduleStarryPing, 1350 + Math.random() * 800);
  }

  function scheduleShimmerBark() {
    if (!shimmerActive) return;
    playCuteBark();
    shimmerBarkInterval = setTimeout(scheduleShimmerBark, 4000 + Math.random() * 2200);
  }

  function startShimmer() {
    if (!audioCtx || !masterGain || shimmerActive) return;
    shimmerActive = true;
    startSunshineParkPad();
    const scheduleChirp = () => {
      if (!shimmerActive) return;
      playBirdChirp();
      if (Math.random() < 0.34) {
        setTimeout(() => {
          if (shimmerActive) playBirdChirp();
        }, 85);
      }
      const delay = 1550 + Math.random() * 950;
      shimmerInterval = setTimeout(scheduleChirp, delay);
    };
    const scheduleBoardwalk = () => {
      if (!shimmerActive) return;
      playBoardwalkPhrase();
      const delay = 1380 + Math.random() * 620;
      shimmerBoardwalkInterval = setTimeout(scheduleBoardwalk, delay);
    };
    scheduleChirp();
    scheduleBoardwalk();
    scheduleStarryPing();
    scheduleShimmerBark();
  }

  function stopShimmer() {
    shimmerActive = false;
    stopSunshineParkPad();
    if (shimmerInterval) {
      clearTimeout(shimmerInterval);
      shimmerInterval = null;
    }
    if (shimmerBoardwalkInterval) {
      clearTimeout(shimmerBoardwalkInterval);
      shimmerBoardwalkInterval = null;
    }
    if (shimmerStarryTimeout) {
      clearTimeout(shimmerStarryTimeout);
      shimmerStarryTimeout = null;
    }
    if (shimmerBarkInterval) {
      clearTimeout(shimmerBarkInterval);
      shimmerBarkInterval = null;
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

