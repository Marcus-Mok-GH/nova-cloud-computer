"""Calm smooth-jazz bed generator for the walkthrough.

Pure numpy synthesis: Rhodes-like chord pads, a walking upright bass, swung
brush/ride ticks and a sparse pentatonic lead. Royalty-free by construction.
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 84
BEAT = 60.0 / BPM
BAR = BEAT * 4


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n, attack, release, total):
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    if a < n:
        e[:a] = np.linspace(0.0, 1.0, a)
    if r < n and r > 0:
        e[-r:] *= np.linspace(1.0, 0.0, r)
    return e[:n]


def add_tone(buf, start, freq, dur, gain, partials=(1.0, 0.28, 0.1, 0.045),
             attack=0.02, release=0.15, pan=0.0, vibrato=0.0, vib_rate=5.0):
    n = int(dur * SR)
    if n <= 0:
        return
    t = np.arange(n) / SR
    f = freq
    if vibrato > 0:
        f = freq * (1.0 + vibrato * np.sin(2 * np.pi * vib_rate * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = np.zeros(n)
    for index, amp in enumerate(partials):
        sig += amp * np.sin(phase * (index + 1))
    sig *= env(n, attack, release, dur) * gain
    # soft saturation for a rounder, analogue feel
    sig = np.tanh(sig * 1.6) / 1.6
    a = max(0.0, min(1.0, 0.5 + pan))
    b = 1.0 - a
    i0 = int(start * SR)
    i1 = min(len(buf), i0 + n)
    if i1 <= i0:
        return
    seg = sig[: i1 - i0]
    buf[i0:i1, 0] += seg * a
    buf[i0:i1, 1] += seg * b


def add_noise_tick(buf, start, dur, gain, center=7000.0, q=0.8):
    n = int(dur * SR)
    if n <= 0:
        return
    rng = np.random.default_rng(int(start * 1000) & 0xFFFF)
    noise = rng.normal(0, 1, n)
    # crude band-pass: one-pole resonate around center
    w = 2 * np.pi * center / SR
    out = np.zeros(n)
    y1 = y2 = 0.0
    r = np.exp(-w / q)
    c = 2 * r * np.cos(w)
    for i in range(n):
        x = noise[i]
        y = x - c * y1 - r * r * y2
        y2, y1 = y1, y
        out[i] = y
    out *= env(n, 0.002, dur * 0.8, dur) * gain
    i0 = int(start * SR)
    i1 = min(len(buf), i0 + n)
    if i1 <= i0:
        return
    seg = out[: i1 - i0]
    buf[i0:i1, 0] += seg * 0.6
    buf[i0:i1, 1] += seg * 0.4


# Smooth-jazz loop: Cmaj9 | Am9 | Dm9 | G13 | Fmaj9 | Dm9 | G9 | Cmaj9
CHORDS = [
    [48, 52, 55, 59, 62],
    [45, 48, 52, 59, 67],
    [50, 53, 57, 60, 64],
    [43, 53, 59, 64, 65],
    [41, 45, 48, 52, 55],
    [50, 53, 57, 60, 64],
    [43, 53, 59, 64, 65],
    [48, 52, 55, 59, 62],
]
BASS_ROOTS = [36, 33, 38, 31, 29, 38, 31, 36]


def generate(duration):
    total = int(duration * SR)
    mix = np.zeros((total, 2))

    bar_index = 0
    cursor = 0.0
    while cursor < duration - 2.0:
        chord = CHORDS[bar_index % len(CHORDS)]
        root = BASS_ROOTS[bar_index % len(BASS_ROOTS)]
        next_root = BASS_ROOTS[(bar_index + 1) % len(BASS_ROOTS)]

        # Pad: whole-bar sustained voicing, slow swell.
        for note in chord:
            add_tone(mix, cursor, midi(note), BAR + 0.25, 0.05,
                     partials=(1.0, 0.32, 0.12, 0.05),
                     attack=0.5, release=0.9, pan=0.12)

        # Comping stabs on the back beats (2 and 4) and the swung "ah" of 1.
        for offset, gain in ((BEAT * 1.0, 0.05), (BEAT * 2.0, 0.045),
                             (BEAT * 3.0, 0.05)):
            for note in chord[1:]:
                add_tone(mix, cursor + offset, midi(note), BEAT * 0.9, gain,
                         partials=(1.0, 0.25, 0.08), attack=0.03, release=0.3,
                         pan=-0.08)

        # Walking bass: root, fifth colour, approach, chromatic lead-in.
        steps = [
            (root, 0.5),
            (root + 7, 0.42),
            (next_root + 12 if abs(next_root + 12 - root) < 12 else next_root + 5, 0.42),
            (next_root + 12, 0.46),
        ]
        for beat_index, (note, gain) in enumerate(steps):
            add_tone(mix, cursor + beat_index * BEAT, midi(note), BEAT * 0.92,
                     gain, partials=(1.0, 0.35, 0.12), attack=0.01,
                     release=0.18, pan=-0.05)

        # Swung ride/brush ticks (triplet feel) and a swish on bar starts.
        for beat_index in range(4):
            base = cursor + beat_index * BEAT
            add_noise_tick(mix, base, 0.06, 0.05, center=7600)
            add_noise_tick(mix, base + BEAT * (2.0 / 3.0), 0.05, 0.032,
                           center=6200)
        add_noise_tick(mix, cursor, 0.5, 0.02, center=4200, q=0.5)

        # Sparse lead phrase: every second bar, five gentle notes.
        if bar_index % 2 == 0:
            scale = [60, 62, 64, 67, 69, 72, 74]
            phrase = [scale[(bar_index // 2 + k) % len(scale)] for k in range(5)]
            for k, note in enumerate(phrase):
                start = cursor + (0.5 + k * 0.72) * BEAT
                add_tone(mix, start, midi(note), BEAT * 0.9, 0.045,
                         partials=(1.0, 0.35, 0.1, 0.03), attack=0.06,
                         release=0.35, pan=-0.35, vibrato=0.004,
                         vib_rate=4.5)

        cursor += BAR
        bar_index += 1

    peak = np.max(np.abs(mix)) + 1e-9
    mix = mix / peak * 0.62
    return mix


def main():
    duration = float(sys.argv[1]) if len(sys.argv) > 1 else 100.0
    out = sys.argv[2] if len(sys.argv) > 2 else "music-jazz.wav"
    mix = generate(duration)
    with wave.open(out, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes((mix * 32767).astype("<i2").tobytes())
    rms = 20 * np.log10(np.sqrt(np.mean(mix ** 2)) + 1e-12)
    print("wrote", out, round(float(np.abs(mix).max()), 3), "peak",
          round(float(rms), 1), "dB RMS")


if __name__ == "__main__":
    main()
