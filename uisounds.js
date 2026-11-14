/*!
 * UISounds — petits sons d'interface 100 % synthétisés (Web Audio API).
 * Licence MIT — https://github.com/coroller1972/uisounds
 * Aucun fichier audio : chaque son est une « recette » d'oscillateurs,
 * de bruit filtré et d'enveloppes.
 *
 *   <script src="uisounds.js"></script>
 *   UISounds.play('tap');                       // ou UISounds.tap()
 *   UISounds.play('woof', { pitch: 0.7 });      // gros chien
 *   UISounds.play('tick', { vary: 0.08 });      // légère variation aléatoire
 *
 * Options de play(name, options) :
 *   volume  0..1   volume de ce son (défaut 1)
 *   pitch   > 0    multiplicateur de hauteur (défaut 1 ; 2 = une octave au-dessus)
 *   vary    0..1   variation aléatoire de hauteur, ±vary (défaut 0)
 *   pan     -1..1  position stéréo (défaut 0)
 *   delay   s      délai avant le déclenchement (défaut 0)
 *
 * Autres membres :
 *   UISounds.names            liste des sons disponibles
 *   UISounds.volume           volume général, 0..1
 *   UISounds.muted            coupe / rétablit le son
 *   UISounds.unlock()         réveille l'audio (à appeler dans un geste utilisateur si besoin)
 *   UISounds.bind(root?)      joue automatiquement les éléments [data-sound="tap"]
 *   UISounds.render(name, o)  Promise<AudioBuffer> (rendu hors ligne, pour visualiser)
 *   UISounds.define(name, fn) ajoute un son personnalisé
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.UISounds = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const hasWindow = typeof window !== 'undefined';
  const AC = hasWindow ? window.AudioContext || window.webkitAudioContext : null;
  const OAC = hasWindow ? window.OfflineAudioContext || window.webkitOfflineAudioContext : null;

  let ctx = null;
  let master = null;
  let volume = 1;
  let muted = false;

  // Le contexte audio n'est créé qu'au premier son : les navigateurs
  // exigent un geste de l'utilisateur avant d'autoriser l'audio.
  function context() {
    if (!ctx && AC) {
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  // Une seconde de bruit blanc par contexte, partagée par tous les sons.
  const noiseCache = new WeakMap();
  function noiseBuffer(c) {
    let buffer = noiseCache.get(c);
    if (!buffer) {
      buffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noiseCache.set(c, buffer);
    }
    return buffer;
  }

  /*
   * La « trousse » passée à chaque recette. Trois briques :
   *   tone(o)    un oscillateur        hiss(o)  du bruit blanc
   *   strike(o)  un choc : bruit très bref dans des résonances (voir plus bas)
   * avec, pour tone et hiss :
   *   at      début, en secondes après le déclenchement
   *   attack  montée linéaire          hold   tenue
   *   decay   extinction exponentielle (≈ -60 dB au bout de `decay`)
   *   gain    niveau de crête          filter { type, freq, q }
   *   to      nœud de destination (défaut : la sortie du son)
   * Une fréquence est soit un nombre, soit un trajet [[t, Hz], [t, Hz]…]
   * parcouru par rampes exponentielles.
   */
  function createKit(c, out, t0, pitch) {
    function automate(param, spec, t) {
      if (typeof spec === 'number') {
        param.setValueAtTime(spec * pitch, t);
        return;
      }
      spec.forEach(function (point, i) {
        if (i === 0) param.setValueAtTime(point[1] * pitch, t + point[0]);
        else param.exponentialRampToValueAtTime(point[1] * pitch, t + point[0]);
      });
    }

    function makeFilter(type, freq, q, t) {
      const f = c.createBiquadFilter();
      f.type = type;
      f.Q.value = q == null ? 1 : q;
      automate(f.frequency, freq, t);
      return f;
    }

    function shape(src, o, t) {
      const peak = o.gain == null ? 1 : o.gain;
      const attack = o.attack == null ? 0.002 : o.attack;
      const hold = o.hold || 0;
      const decay = o.decay == null ? 0.1 : o.decay;

      let node = src;
      if (o.filter) {
        const f = makeFilter(o.filter.type, o.filter.freq, o.filter.q, t);
        node.connect(f);
        node = f;
      }

      const g = c.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + attack + hold);
      g.gain.setTargetAtTime(0, t + attack + hold, decay / 7);
      node.connect(g);
      g.connect(o.to || out);

      const stop = t + attack + hold + decay;
      src.stop(stop);
      kit.end = Math.max(kit.end, stop);
    }

    const kit = {
      ctx: c,
      out: out,
      t0: t0,
      end: t0,

      gain: function (value) {
        const g = c.createGain();
        g.gain.value = value;
        return g;
      },

      filter: function (type, freq, q) {
        return makeFilter(type, freq, q, t0);
      },

      tone: function (o) {
        const t = t0 + (o.at || 0);
        const src = c.createOscillator();
        src.type = o.type || 'sine';
        automate(src.frequency, o.freq, t);
        src.start(t);
        shape(src, o, t);
      },

      hiss: function (o) {
        const t = t0 + (o.at || 0);
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c);
        src.loop = true;
        src.start(t, Math.random() * 0.5);
        shape(src, o, t);
      },

      // Un choc sur de la matière : un souffle de quelques millisecondes qui
      // excite des résonances — modes : [[Hz, Q, gain]…]. Ni oscillateur ni
      // hauteur qui glisse : c'est ce qui évite l'effet « jeu vidéo ».
      // `texture` ajoute un rien de bruit direct, adouci.
      strike: function (o) {
        const t = t0 + (o.at || 0);
        const dest = o.to || out;
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c);

        const env = c.createGain();
        env.gain.value = 0;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(o.gain == null ? 1 : o.gain, t + 0.001);
        env.gain.exponentialRampToValueAtTime(0.0005, t + (o.decay || 0.018));
        src.connect(env);

        o.modes.forEach(function (mode) {
          const f = makeFilter('bandpass', mode[0], mode[1], t);
          const g = c.createGain();
          g.gain.value = mode[2];
          env.connect(f);
          f.connect(g);
          g.connect(dest);
        });
        if (o.texture) {
          const f = makeFilter('lowpass', 2500, 1, t);
          const g = c.createGain();
          g.gain.value = o.texture;
          env.connect(f);
          f.connect(g);
          g.connect(dest);
        }

        // Décalage aléatoire dans le bruit : deux chocs ne sont jamais identiques.
        src.start(t, Math.random() * 0.9, 0.04);
        kit.end = Math.max(kit.end, t + 0.06);
      }
    };
    return kit;
  }

  // ───────────────────────────── Les sons ─────────────────────────────

  const recipes = {
    // Petit choc boisé et mat : les résonances d'une pièce de carton épais
    // posée sur du bois. Des Q bas — rien ne sonne longtemps ni ne « chante ».
    tap: function (k) {
      const body = k.gain(3.4);
      const soft = k.filter('lowpass', 3200); // pas d'aigus métalliques
      body.connect(soft);
      soft.connect(k.out);
      k.strike({
        to: body,
        texture: 0.05,
        modes: [
          [170, 2.5, 1.6], // le corps sourd, posé sur la table
          [480, 4, 1.2],
          [1100, 5, 0.4],
          [2200, 4, 0.12]
        ]
      });
    },

    // Clic mécanique net (bouton de souris, interrupteur).
    click: function (k) {
      k.hiss({ filter: { type: 'bandpass', freq: 2600, q: 1.2 }, attack: 0.0005, decay: 0.016, gain: 1.6 });
      k.tone({ type: 'square', freq: [[0, 1900], [0.006, 900]], attack: 0.0005, decay: 0.009, gain: 0.18 });
      k.tone({ freq: 190, attack: 0.001, decay: 0.022, gain: 0.35 });
    },

    // Tic minuscule et aigu (cran de molette, horloge).
    tick: function (k) {
      k.hiss({ filter: { type: 'bandpass', freq: 6200, q: 3 }, attack: 0.0003, decay: 0.012, gain: 2.4 });
      k.tone({ freq: 3300, attack: 0.0003, decay: 0.012, gain: 0.3 });
    },

    // Coup sec sur du bois.
    toc: function (k) {
      k.tone({ freq: [[0, 1000], [0.012, 560]], attack: 0.001, decay: 0.09, gain: 0.75 });
      k.tone({ freq: 1340, attack: 0.001, decay: 0.03, gain: 0.2 });
      k.hiss({ filter: { type: 'bandpass', freq: 1500, q: 2 }, attack: 0.0005, decay: 0.012, gain: 0.6 });
    },

    // Tape feutrée et mate (main sur un coussin).
    pat: function (k) {
      k.hiss({ filter: { type: 'lowpass', freq: 700 }, attack: 0.003, decay: 0.07, gain: 1.3 });
      k.tone({ freq: [[0, 190], [0.06, 80]], attack: 0.003, decay: 0.09, gain: 0.6 });
    },

    // Bulle qui éclate.
    pop: function (k) {
      k.tone({ freq: [[0, 280], [0.022, 1100]], attack: 0.002, decay: 0.045, gain: 0.8 });
      k.hiss({ filter: { type: 'bandpass', freq: 1800, q: 1 }, attack: 0.0005, decay: 0.008, gain: 0.3 });
    },

    // Goutte d'eau : la hauteur plonge puis remonte.
    bloop: function (k) {
      k.tone({ freq: [[0, 520], [0.06, 240], [0.15, 640]], attack: 0.004, hold: 0.05, decay: 0.13, gain: 0.7 });
    },

    // Bip rétro.
    blip: function (k) {
      k.tone({
        type: 'square', freq: 880, attack: 0.002, hold: 0.035, decay: 0.04, gain: 0.3,
        filter: { type: 'lowpass', freq: 3200 }
      });
    },

    // Clochette de notification : un fondamental et deux partiels inharmoniques.
    ding: function (k) {
      k.tone({ freq: 1320, attack: 0.002, decay: 0.9, gain: 0.5 });
      k.tone({ freq: 2646, attack: 0.002, decay: 0.5, gain: 0.16 });
      k.tone({ freq: 3643, attack: 0.001, decay: 0.22, gain: 0.1 });
      k.hiss({ filter: { type: 'highpass', freq: 4000 }, attack: 0.0005, decay: 0.01, gain: 0.12 });
    },

    // Aboiement : une dent de scie (les cordes vocales) dans deux formants
    // qui s'ouvrent puis se referment — « w-OU-f » —, plus le souffle du « f ».
    woof: function (k) {
      const mouth = k.gain(1);
      [
        { freq: [[0, 320], [0.05, 720], [0.22, 380]], q: 4, gain: 1.6 },
        { freq: [[0, 700], [0.05, 1250], [0.22, 800]], q: 5, gain: 1.0 }
      ].forEach(function (formant) {
        const f = k.filter('bandpass', formant.freq, formant.q);
        const g = k.gain(formant.gain);
        mouth.connect(f);
        f.connect(g);
        g.connect(k.out);
      });
      const chest = k.filter('lowpass', 260, 1);
      const chestGain = k.gain(0.5);
      mouth.connect(chest);
      chest.connect(chestGain);
      chestGain.connect(k.out);

      const pitchPath = [[0, 130], [0.04, 270], [0.22, 100]];
      const growlPath = pitchPath.map(function (p) { return [p[0], p[1] / 2]; });
      k.tone({ type: 'sawtooth', freq: pitchPath, attack: 0.012, hold: 0.045, decay: 0.17, gain: 0.8, to: mouth });
      k.tone({ type: 'square', freq: growlPath, attack: 0.012, hold: 0.045, decay: 0.17, gain: 0.3, to: mouth });
      k.hiss({ filter: { type: 'lowpass', freq: 3000 }, attack: 0.012, hold: 0.045, decay: 0.17, gain: 0.3, to: mouth });
      k.hiss({ at: 0.15, filter: { type: 'highpass', freq: 2200 }, attack: 0.03, decay: 0.1, gain: 0.06 });
    },

    // « Chut » : bruit concentré autour de 3–4 kHz, avec une montée douce.
    shh: function (k) {
      k.hiss({
        filter: { type: 'bandpass', freq: [[0, 2800], [0.12, 3800], [0.55, 3000]], q: 0.9 },
        attack: 0.09, hold: 0.18, decay: 0.35, gain: 0.7
      });
      k.hiss({ filter: { type: 'highpass', freq: 5200 }, attack: 0.1, hold: 0.15, decay: 0.3, gain: 0.1 });
    },

    // Souffle de glissement (envoi, transition) : un filtre qui balaie le bruit.
    whoosh: function (k) {
      k.hiss({
        filter: { type: 'bandpass', freq: [[0, 300], [0.18, 2600], [0.42, 500]], q: 1.4 },
        attack: 0.16, hold: 0.02, decay: 0.3, gain: 1.1
      });
    },

    // Réussite : trois notes montantes (do – mi – sol).
    success: function (k) {
      [[0, 1046.5, 0.22], [0.09, 1318.5, 0.22], [0.18, 1568, 0.45]].forEach(function (note) {
        k.tone({ at: note[0], freq: note[1], attack: 0.004, decay: note[2], gain: 0.4 });
        k.tone({ at: note[0], type: 'triangle', freq: note[1] * 2, attack: 0.004, decay: note[2] / 2, gain: 0.08 });
      });
    },

    // Refus : deux notes basses et un peu râpeuses, la seconde plus grave.
    error: function (k) {
      [[0, 196, 0.07], [0.13, 147, 0.13]].forEach(function (note) {
        k.tone({
          at: note[0], type: 'square', freq: note[1], attack: 0.004, hold: note[2], decay: 0.07, gain: 0.45,
          filter: { type: 'lowpass', freq: 900 }
        });
      });
    }
  };

  // ─────────────────────────── Déclenchement ───────────────────────────

  function options(opts) {
    opts = opts || {};
    const vary = Math.max(0, opts.vary || 0);
    const jitter = vary ? 1 + (Math.random() * 2 - 1) * vary : 1;
    return {
      volume: opts.volume == null ? 1 : Math.max(0, opts.volume),
      pitch: Math.max(0.05, (opts.pitch == null ? 1 : opts.pitch) * jitter),
      pan: Math.max(-1, Math.min(1, opts.pan || 0)),
      delay: Math.max(0, opts.delay || 0)
    };
  }

  // Programme une recette sur un contexte (temps réel ou hors ligne) et
  // renvoie la durée du son en secondes.
  function schedule(c, dest, recipe, t0, o) {
    const out = c.createGain();
    out.gain.value = o.volume;
    if (o.pan && c.createStereoPanner) {
      const panner = c.createStereoPanner();
      panner.pan.value = o.pan;
      out.connect(panner);
      panner.connect(dest);
    } else {
      out.connect(dest);
    }
    const kit = createKit(c, out, t0, o.pitch);
    recipe(kit);
    return kit.end - t0;
  }

  function play(name, opts) {
    const recipe = recipes[name];
    if (!recipe) {
      if (typeof console !== 'undefined') console.warn('UISounds : son inconnu « ' + name + ' »');
      return 0;
    }
    const c = context();
    if (!c) return 0;
    if (c.state === 'suspended') c.resume();
    const o = options(opts);
    return schedule(c, master, recipe, c.currentTime + o.delay, o);
  }

  function render(name, opts) {
    const recipe = recipes[name];
    if (!recipe) return Promise.reject(new Error('UISounds : son inconnu « ' + name + ' »'));
    if (!OAC) return Promise.reject(new Error('UISounds : OfflineAudioContext indisponible'));
    const o = options(opts);
    const rate = 44100;
    // Passe à blanc sur un contexte d'un échantillon, juste pour mesurer la durée.
    const probe = new OAC(1, 1, rate);
    const duration = schedule(probe, probe.destination, recipe, 0, o);
    const offline = new OAC(o.pan ? 2 : 1, Math.ceil(duration * rate), rate);
    schedule(offline, offline.destination, recipe, 0, o);
    return offline.startRendering();
  }

  function applyVolume() {
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.01);
  }

  const api = {
    play: play,
    render: render,

    unlock: function () {
      const c = context();
      return c && c.state === 'suspended' ? c.resume() : Promise.resolve();
    },

    bind: function (target) {
      target = target || document;
      target.addEventListener('pointerdown', function (event) {
        const el = event.target.closest ? event.target.closest('[data-sound]') : null;
        if (el) play(el.getAttribute('data-sound'));
      });
    },

    define: function (name, recipe) {
      if (typeof recipe !== 'function') throw new TypeError('UISounds.define : la recette doit être une fonction');
      if (name in api && !(name in recipes)) throw new Error('UISounds.define : « ' + name + ' » est un nom réservé');
      recipes[name] = recipe;
      shortcut(name);
    }
  };

  function shortcut(name) {
    api[name] = function (opts) { return play(name, opts); };
  }
  Object.keys(recipes).forEach(shortcut);

  Object.defineProperties(api, {
    names: { enumerable: true, get: function () { return Object.keys(recipes); } },
    context: { enumerable: true, get: function () { return ctx; } },
    volume: {
      enumerable: true,
      get: function () { return volume; },
      set: function (v) { volume = Math.max(0, Math.min(1, +v || 0)); applyVolume(); }
    },
    muted: {
      enumerable: true,
      get: function () { return muted; },
      set: function (v) { muted = !!v; applyVolume(); }
    }
  });

  return api;
});
