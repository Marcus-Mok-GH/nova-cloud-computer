"""Synthesize a calm ambient bed for the demo (royalty-free by construction).

Warm major-7 pad: Cmaj7 -> Am7 -> Fmaj7 -> Gadd9, two slow passes, with soft
chord crossfades, detuned stereo voices and a breath of filtered air.
"""
import numpy as np

SR = 44100
DURATION = 93.0
CHORD_S = 11.0
CROSSFADE_S = 2.5

CHORDS = [
    [130.81, 164.81, 196.00, 246.94, 293.66],   # Cmaj7
    [110.00, 130.81, 164.81, 196.00],           # Am7
    [87.31, 110.00, 130.81, 164.81],            # Fmaj7
    [98.00, 123.47, 146.83, 220.00],            # Gadd9
]


def chord_block(freqs, seconds, rng):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    left = np.zeros(n)
    right = np.zeros(n)
    for f in freqs:
        for channel, detune, phase in ((left, 1.0000, 0.0), (right, 1.0006, 0.7)):
            base = f * detune
            osc = np.sin(2 * np.pi * base * t + phase)
            osc += 0.32 * np.sin(2 * np.pi * base * 2 * t + phase * 1.7)
            osc += 0.10 * np.sin(2 * np.pi * base * 3 * t + phase * 2.3)
            osc *= 1.0 / (1.0 + 0.12 * (base / 100.0))
            channel += osc
    block = np.stack([left, right], axis=1)
    block /= max(1e-9, np.max(np.abs(block)))
    # slow swell so repeated chords never feel looped
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * t / (seconds * 1.7) + rng.uniform(0, 6.28))
    return block * lfo[:, None] * 0.16


def cosine_ramp(n, up, down):
    env = np.ones(n)
    u = min(int(up * SR), n // 2)
    d = min(int(down * SR), n // 2)
    if u > 0:
        env[:u] = 0.5 - 0.5 * np.cos(np.pi * np.arange(u) / u)
    if d > 0:
        env[-d:] = 0.5 - 0.5 * np.cos(np.pi * np.arange(d)[::-1] / d)
    return env


rng = np.random.default_rng(7)
total = int(DURATION * SR)
mix = np.zeros((total, 2))

cursor = 0.0
index = 0
while cursor < DURATION - 1.0:
    freqs = CHORDS[index % len(CHORDS)]
    block_len = int(min(CHORD_S + CROSSFADE_S, DURATION - cursor) * SR)
    block = chord_block(freqs, block_len / SR, rng)[:block_len]
    env = cosine_ramp(block_len, up=1.2, down=CROSSFADE_S)
    end = min(total, int(cursor * SR) + block_len)
    mix[int(cursor * SR):end] += block[: end - int(cursor * SR)] * env[: end - int(cursor * SR), None]
    cursor += CHORD_S
    index += 1

# breath of air: gentle noise swells
noise = rng.normal(0, 1, total)
air = np.zeros(total)
alpha = 1 - np.exp(-1.0 / (SR * 0.4))
for i in range(1, total):
    air[i] = air[i - 1] + alpha * (noise[i] - air[i - 1])
air /= np.max(np.abs(air)) + 1e-9
swell = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(total) / (SR * 9.0) + 0.6)
mix += (air * swell * 0.012)[:, None]

peak = np.max(np.abs(mix))
mix = mix / peak * 0.62

import wave

with wave.open("music-raw.wav", "wb") as handle:
    handle.setnchannels(2)
    handle.setsampwidth(2)
    handle.setframerate(SR)
    handle.writeframes((mix * 32767).astype("<i2").tobytes())
print("wrote music-raw.wav", round(float(np.abs(mix).max()), 3), "peak")
