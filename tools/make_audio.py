#!/usr/bin/env python3
# ============================================================
# make_audio.py — generates audio/ambient.wav
# A seamless-looping deep-space drone: layered integer-ratio
# sine partials (phase-continuous across the loop), slow LFO
# swells, and low-passed noise air, crossfade-looped.
# Pure stdlib (math, wave, struct). ~48 s @ 22050 Hz mono.
# ============================================================
import math, wave, struct, random

SR = 22050
LOOP = 48            # seconds
XF = 8               # crossfade seconds
N = LOOP * SR        # loop samples
TOTAL = (LOOP + XF) * SR

random.seed(1901)

# ---- layers -------------------------------------------------
# (freq Hz [integer => loop phase-continuous], level, lfo period s [divides 48], lfo phase)
PARTIALS = [
    (55,  0.32, 48.0, 0.00),
    (110, 0.22, 24.0, 1.30),
    (111, 0.20, 24.0, 4.10),   # 1 Hz beating pair with 110
    (165, 0.12, 16.0, 2.20),
    (220, 0.075, 12.0, 0.70),
    (221, 0.070, 12.0, 3.60),
    (330, 0.035, 48.0, 5.10),
    (28,  0.30, 48.0, 2.00),   # sub swell
]

lp_state = 0.0
lp_lfo_p1 = random.random() * 6.283
lp_lfo_p2 = random.random() * 6.283

def lfo(t, period, phase):
    return 0.5 + 0.5 * math.sin(2.0 * math.pi * t / period + phase)

def gen(i):
    """sample at index i in [0, TOTAL)"""
    t = i / SR
    # sines with slow amplitude swells
    s = 0.0
    for f, lvl, per, ph in PARTIALS:
        s += lvl * (0.55 + 0.45 * lfo(t, per, ph)) * math.sin(2.0 * math.pi * f * t + ph * 0.37 * f)
    # low-passed noise air (one-pole), cutoff slowly breathing
    global lp_state, lp_lfo_p1, lp_lfo_p2
    cutoff = 320.0 + 900.0 * (0.5 + 0.5 * math.sin(2.0 * math.pi * t / 16.0 + lp_lfo_p1))
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff / SR)
    n = random.uniform(-1.0, 1.0)
    lp_state += a * (n - lp_state)
    s += 0.55 * lp_state * (0.6 + 0.4 * math.sin(2.0 * math.pi * t / 24.0 + lp_lfo_p2))
    # very slow distant "engine" pulse
    s *= 0.82 + 0.18 * math.sin(2.0 * math.pi * t / 48.0)
    return s

# ---- render + crossfade-loop -------------------------------
buf = [gen(i) for i in range(TOTAL)]

xf_n = XF * SR
out = [0.0] * N
for i in range(N):
    if i < xf_n:
        w = i / xf_n                       # 0 -> 1
        out[i] = buf[i] * (1.0 - w) + buf[N + i] * w   # tail folds onto head
    else:
        out[i] = buf[i]

# ---- normalize to -8 dBFS-ish -------------------------------
peak = max(abs(x) for x in out) or 1.0
g = 0.42 / peak

with wave.open('audio/ambient.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    frames = bytearray()
    for x in out:
        v = max(-1.0, min(1.0, x * g))
        frames += struct.pack('<h', int(v * 32767))
    w.writeframes(bytes(frames))

print('audio/ambient.wav written:', N, 'samples,', LOOP, 's loop,', round(len(frames) / 1024 / 1024, 2), 'MiB')
