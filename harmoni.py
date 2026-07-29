#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HARMONI V3

Kamera acikken iki eli takip eden, soylenen sesi analiz eden, tonaliteye gore
piyano esligi ureten, jestlerle enstruman katmanlarini yoneten ve vokale hafif
reverb/echo uygulayan tek dosyali Python uygulamasi.

Temel kurulum:
    python -m pip install -r requirements.txt

Calistirma:
    python harmoni.py

Donanim olmadan test:
    python harmoni.py --self-test

Tuslar:
    Q / ESC    Cikis
    H          HUD ac/kapat
    E          Vokal efektlerini ac/kapat
    V          Canli vokal monitoring ac/kapat
    M          Ayna modu ac/kapat
    F          Tam orkestrayi ac
    X          Ek katmanlari sustur
    SPACE      Tap tempo
    [ / ]      BPM azalt/artir
    - / +      Reverb azalt/artir
    S          Ekran goruntusu
    R          Kayit ac/kapat
    1-4        Tema degistir

Onemli:
    Canli vokal monitoring icin kulaklik kullanin. Hoparlor kullanimi geri
    besleme ve otme olusturabilir.
"""

from __future__ import annotations

import argparse
import math
import os
import queue
import random
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Deque, Dict, Iterable, List, Optional, Sequence, Set, Tuple

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("ABSL_LOGGING_MIN_LEVEL", "3")

import cv2
import numpy as np

try:
    import mediapipe as mp
    MP_AVAILABLE = True
except Exception as exc:  # pragma: no cover - donanim/kurulum bagimliligi
    mp = None
    MP_AVAILABLE = False
    MP_IMPORT_ERROR = exc

try:
    import sounddevice as sd
    SOUNDDEVICE_AVAILABLE = True
except Exception as exc:  # pragma: no cover - donanim/kurulum bagimliligi
    sd = None
    SOUNDDEVICE_AVAILABLE = False
    SOUNDDEVICE_IMPORT_ERROR = exc


# -----------------------------------------------------------------------------
# SABITLER
# -----------------------------------------------------------------------------

CAMERA_INDEX = 0
CAM_WIDTH = 1280
CAM_HEIGHT = 720
CAM_FPS = 30
CAM_CAPTURE_WIDTH = 960
CAM_CAPTURE_HEIGHT = 540
HAND_PROCESS_WIDTH = 512
MAX_HANDS = 2

AUDIO_SR = 48_000
AUDIO_BLOCK = 256
AUDIO_CHANNELS_IN = 1
AUDIO_CHANNELS_OUT = 2

OUTPUT_DIR = Path("harmoni_captures")

Color = Tuple[int, int, int]  # OpenCV BGR
Point = Tuple[int, int]

WRIST = 0
THUMB_CMC = 1
THUMB_MCP = 2
THUMB_IP = 3
THUMB_TIP = 4
INDEX_MCP = 5
INDEX_PIP = 6
INDEX_DIP = 7
INDEX_TIP = 8
MIDDLE_MCP = 9
MIDDLE_PIP = 10
MIDDLE_DIP = 11
MIDDLE_TIP = 12
RING_MCP = 13
RING_PIP = 14
RING_DIP = 15
RING_TIP = 16
PINKY_MCP = 17
PINKY_PIP = 18
PINKY_DIP = 19
PINKY_TIP = 20

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOTE_NAMES_TR = ["DO", "DO#", "RE", "RE#", "MI", "FA", "FA#", "SOL", "SOL#", "LA", "LA#", "SI"]


# -----------------------------------------------------------------------------
# TEMA VE CIZIM YARDIMCILARI
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class Theme:
    name: str
    bg: Color
    panel: Color
    panel2: Color
    text: Color
    muted: Color
    primary: Color
    secondary: Color
    accent: Color
    danger: Color
    success: Color
    warning: Color


THEMES: List[Theme] = [
    Theme(
        "PEARL",
        (236, 241, 246), (249, 250, 252), (229, 231, 238),
        (58, 57, 63), (128, 124, 133),
        (194, 151, 171), (168, 190, 226), (176, 205, 190),
        (132, 128, 224), (151, 193, 165), (165, 188, 220),
    ),
    Theme(
        "LILAC",
        (243, 238, 247), (252, 250, 253), (231, 222, 239),
        (62, 55, 68), (132, 119, 139),
        (194, 157, 209), (190, 182, 231), (181, 211, 207),
        (142, 132, 221), (159, 198, 172), (180, 194, 226),
    ),
    Theme(
        "PEACH",
        (238, 243, 248), (252, 251, 249), (229, 226, 235),
        (67, 59, 57), (137, 126, 123),
        (173, 188, 234), (192, 211, 239), (182, 207, 196),
        (139, 137, 220), (154, 195, 165), (177, 194, 224),
    ),
    Theme(
        "SAGE",
        (239, 244, 240), (251, 252, 250), (225, 235, 229),
        (55, 64, 59), (116, 132, 123),
        (173, 202, 181), (191, 206, 229), (191, 180, 215),
        (133, 139, 215), (151, 194, 166), (180, 199, 221),
    ),
]


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * clamp(t, 0.0, 1.0)


def dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def alpha_blend(dst: np.ndarray, overlay: np.ndarray, alpha: float) -> None:
    cv2.addWeighted(overlay, clamp(alpha, 0.0, 1.0), dst, 1.0 - clamp(alpha, 0.0, 1.0), 0, dst)


def rounded_rect(
    img: np.ndarray,
    pt1: Point,
    pt2: Point,
    color: Color,
    radius: int = 18,
    thickness: int = -1,
) -> None:
    x1, y1 = pt1
    x2, y2 = pt2
    radius = max(1, min(radius, (x2 - x1) // 2, (y2 - y1) // 2))
    if thickness < 0:
        cv2.rectangle(img, (x1 + radius, y1), (x2 - radius, y2), color, -1, cv2.LINE_AA)
        cv2.rectangle(img, (x1, y1 + radius), (x2, y2 - radius), color, -1, cv2.LINE_AA)
        for cx, cy in ((x1 + radius, y1 + radius), (x2 - radius, y1 + radius),
                       (x1 + radius, y2 - radius), (x2 - radius, y2 - radius)):
            cv2.circle(img, (cx, cy), radius, color, -1, cv2.LINE_AA)
    else:
        cv2.line(img, (x1 + radius, y1), (x2 - radius, y1), color, thickness, cv2.LINE_AA)
        cv2.line(img, (x1 + radius, y2), (x2 - radius, y2), color, thickness, cv2.LINE_AA)
        cv2.line(img, (x1, y1 + radius), (x1, y2 - radius), color, thickness, cv2.LINE_AA)
        cv2.line(img, (x2, y1 + radius), (x2, y2 - radius), color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x1 + radius, y1 + radius), (radius, radius), 180, 0, 90, color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x2 - radius, y1 + radius), (radius, radius), 270, 0, 90, color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x2 - radius, y2 - radius), (radius, radius), 0, 0, 90, color, thickness, cv2.LINE_AA)
        cv2.ellipse(img, (x1 + radius, y2 - radius), (radius, radius), 90, 0, 90, color, thickness, cv2.LINE_AA)


def draw_text(
    img: np.ndarray,
    text: str,
    x: int,
    y: int,
    scale: float,
    color: Color,
    thickness: int = 1,
    font: int = cv2.FONT_HERSHEY_SIMPLEX,
) -> None:
    cv2.putText(img, text, (int(x), int(y)), font, scale, color, thickness, cv2.LINE_AA)


def draw_glow_text(
    img: np.ndarray,
    text: str,
    x: int,
    y: int,
    scale: float,
    color: Color,
    thickness: int = 1,
) -> None:
    overlay = img.copy()
    cv2.putText(overlay, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness + 5, cv2.LINE_AA)
    overlay = cv2.GaussianBlur(overlay, (0, 0), 7)
    alpha_blend(img, overlay, 0.23)
    draw_text(img, text, x, y, scale, color, thickness)


def draw_neon_line(
    img: np.ndarray,
    p1: Point,
    p2: Point,
    color: Color,
    thickness: int = 1,
    glow: float = 0.18,
) -> None:
    overlay = np.zeros_like(img)
    cv2.line(overlay, p1, p2, color, max(3, thickness + 5), cv2.LINE_AA)
    overlay = cv2.GaussianBlur(overlay, (0, 0), 7)
    alpha_blend(img, overlay, glow)
    cv2.line(img, p1, p2, color, thickness, cv2.LINE_AA)


def draw_neon_circle(
    img: np.ndarray,
    center: Point,
    radius: int,
    color: Color,
    thickness: int = 1,
    glow: float = 0.18,
) -> None:
    overlay = np.zeros_like(img)
    cv2.circle(overlay, center, radius, color, max(3, thickness + 5), cv2.LINE_AA)
    overlay = cv2.GaussianBlur(overlay, (0, 0), 8)
    alpha_blend(img, overlay, glow)
    cv2.circle(img, center, radius, color, thickness, cv2.LINE_AA)


def glass_card(
    img: np.ndarray,
    blurred: np.ndarray,
    x: int,
    y: int,
    w: int,
    h: int,
    theme: Theme,
    alpha: float = 0.76,
    border: Optional[Color] = None,
) -> None:
    x2, y2 = x + w, y + h
    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    rounded_rect(mask, (x, y), (x2, y2), 255, radius=18, thickness=-1)
    region = img.copy()
    region[mask > 0] = blurred[mask > 0]
    alpha_blend(img, region, 0.34)
    overlay = img.copy()
    rounded_rect(overlay, (x, y), (x2, y2), theme.panel, radius=18, thickness=-1)
    alpha_blend(img, overlay, alpha)
    rounded_rect(img, (x, y), (x2, y2), border or theme.panel2, radius=18, thickness=1)


def draw_meter(
    img: np.ndarray,
    x: int,
    y: int,
    w: int,
    value: float,
    color: Color,
    theme: Theme,
    label: str,
    value_text: str,
) -> None:
    value = clamp(value, 0.0, 1.0)
    draw_text(img, label, x, y, 0.35, theme.muted, 1)
    draw_text(img, value_text, x + w - 48, y, 0.35, theme.text, 1)
    by = y + 10
    rounded_rect(img, (x, by), (x + w, by + 8), theme.panel2, radius=4, thickness=-1)
    if value > 0.01:
        rounded_rect(img, (x, by), (x + max(8, int(w * value)), by + 8), color, radius=4, thickness=-1)


def draw_corner_frame(img: np.ndarray, x: int, y: int, w: int, h: int, color: Color) -> None:
    length = 24
    for p1, p2 in [
        ((x, y), (x + length, y)), ((x, y), (x, y + length)),
        ((x + w, y), (x + w - length, y)), ((x + w, y), (x + w, y + length)),
        ((x, y + h), (x + length, y + h)), ((x, y + h), (x, y + h - length)),
        ((x + w, y + h), (x + w - length, y + h)), ((x + w, y + h), (x + w, y + h - length)),
    ]:
        cv2.line(img, p1, p2, color, 2, cv2.LINE_AA)


def midi_to_name(midi_note: int, turkish: bool = False) -> str:
    names = NOTE_NAMES_TR if turkish else NOTE_NAMES
    octave = midi_note // 12 - 1
    return f"{names[midi_note % 12]}{octave}"


def frequency_to_midi(frequency: float) -> float:
    return 69.0 + 12.0 * math.log2(max(frequency, 1e-6) / 440.0)


def midi_to_frequency(midi_note: float) -> float:
    return 440.0 * (2.0 ** ((midi_note - 69.0) / 12.0))


# -----------------------------------------------------------------------------
# PAYLASILAN DURUM VE PITCH TAKIBI
# -----------------------------------------------------------------------------

@dataclass
class PitchSnapshot:
    frequency: float = 0.0
    midi_note: int = -1
    note_name: str = "--"
    confidence: float = 0.0
    rms: float = 0.0
    cents: float = 0.0
    voiced: bool = False
    timestamp: float = 0.0


@dataclass
class MusicSnapshot:
    key_name: str = "G# MINOR"
    key_root: int = 8
    mode: str = "minor"
    chord_name: str = "G#m"
    chord_notes: Tuple[int, ...] = (44, 47, 51)
    bpm: float = 88.0
    beat_phase: float = 0.0
    key_confidence: float = 0.0
    accompaniment_confidence: float = 0.0
    vocal_center_midi: float = 57.0
    phrase_active: bool = False
    chord_revision: int = 0


@dataclass
class RuntimeState:
    pitch: PitchSnapshot = field(default_factory=PitchSnapshot)
    music: MusicSnapshot = field(default_factory=MusicSnapshot)
    vocal_level: float = 0.0
    output_level: float = 0.0
    audio_status: str = "AUDIO OFFLINE"
    camera_status: str = "CAMERA OFFLINE"
    camera_fps: float = 0.0
    detector_fps: float = 0.0
    gesture: str = "SCANNING"
    gesture_detail: str = "ELLER BEKLENIYOR"
    active_layers: Set[str] = field(default_factory=lambda: {"PIANO"})
    waveform: np.ndarray = field(default_factory=lambda: np.zeros(256, dtype=np.float32))
    latency_ms: float = 0.0
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class PitchTracker(threading.Thread):
    """Dusuk maliyetli gercek zamanli monofonik pitch takipcisi.

    TorchCREPE kurulu olmadigi durumda da calismasi icin FFT otokorelasyonu kullanir.
    Pitch worker ayri thread'de calisir; ses callback'i bekletilmez.
    """

    def __init__(self, state: RuntimeState, sample_rate: int = AUDIO_SR) -> None:
        super().__init__(daemon=True, name="PitchTracker")
        self.state = state
        self.sample_rate = sample_rate
        self.input_queue: "queue.Queue[np.ndarray]" = queue.Queue(maxsize=6)
        self.stop_event = threading.Event()
        self.buffer = np.zeros(8192, dtype=np.float32)
        self.write_count = 0
        self.frequency_history: Deque[float] = deque(maxlen=5)
        self.note_history: Deque[int] = deque(maxlen=5)

    def submit(self, samples: np.ndarray) -> None:
        try:
            self.input_queue.put_nowait(np.asarray(samples, dtype=np.float32).copy())
        except queue.Full:
            try:
                _ = self.input_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self.input_queue.put_nowait(np.asarray(samples, dtype=np.float32).copy())
            except queue.Full:
                pass

    def stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:  # pragma: no cover - gercek zamanli thread
        while not self.stop_event.is_set():
            try:
                chunk = self.input_queue.get(timeout=0.2)
            except queue.Empty:
                continue
            n = len(chunk)
            if n >= len(self.buffer):
                self.buffer[:] = chunk[-len(self.buffer):]
            else:
                self.buffer[:-n] = self.buffer[n:]
                self.buffer[-n:] = chunk
            self.write_count += n
            if self.write_count < 1024:
                continue
            self.write_count = 0
            snapshot = self.detect(self.buffer[-3072:])
            with self.state.lock:
                self.state.pitch = snapshot

    def detect(self, samples: np.ndarray) -> PitchSnapshot:
        x = np.asarray(samples, dtype=np.float64)
        x = x - np.mean(x)
        rms = float(np.sqrt(np.mean(x * x) + 1e-12))
        now = time.time()
        if rms < 0.0045:
            self.frequency_history.clear()
            self.note_history.clear()
            return PitchSnapshot(rms=rms, timestamp=now)

        x *= np.hanning(len(x))
        n_fft = 1 << (2 * len(x) - 1).bit_length()
        spectrum = np.fft.rfft(x, n=n_fft)
        corr = np.fft.irfft(spectrum * np.conj(spectrum), n=n_fft)[:len(x)]
        zero = float(max(corr[0], 1e-12))

        min_freq = 70.0
        max_freq = 1100.0
        min_lag = max(2, int(self.sample_rate / max_freq))
        max_lag = min(len(corr) - 2, int(self.sample_rate / min_freq))
        local = corr[min_lag:max_lag]
        if local.size == 0:
            return PitchSnapshot(rms=rms, timestamp=now)

        # Ilk anlamli tepeyi aramak oktav hatalarini azaltir.
        peaks: List[int] = []
        for i in range(1, len(local) - 1):
            if local[i] > local[i - 1] and local[i] >= local[i + 1]:
                peaks.append(i + min_lag)
        if not peaks:
            lag = int(np.argmax(local) + min_lag)
        else:
            peak_values = np.array([corr[p] for p in peaks])
            global_peak = float(np.max(peak_values))
            eligible = [p for p in peaks if corr[p] >= global_peak * 0.82]
            lag = min(eligible) if eligible else peaks[int(np.argmax(peak_values))]

        if 1 <= lag < len(corr) - 1:
            y0, y1, y2 = corr[lag - 1], corr[lag], corr[lag + 1]
            denom = y0 - 2.0 * y1 + y2
            if abs(denom) > 1e-12:
                lag = float(lag) + 0.5 * float(y0 - y2) / float(denom)

        frequency = float(self.sample_rate / max(float(lag), 1.0))
        confidence = float(clamp(corr[int(round(lag))] / zero, 0.0, 1.0))
        if not (min_freq <= frequency <= max_freq) or confidence < 0.24:
            return PitchSnapshot(rms=rms, confidence=confidence, timestamp=now)

        self.frequency_history.append(frequency)
        smooth_frequency = float(np.median(np.asarray(self.frequency_history)))
        midi_float = frequency_to_midi(smooth_frequency)
        midi_note = int(round(midi_float))
        self.note_history.append(midi_note)
        if self.note_history:
            values, counts = np.unique(np.asarray(self.note_history), return_counts=True)
            midi_note = int(values[int(np.argmax(counts))])
        cents = float(1200.0 * math.log2(smooth_frequency / midi_to_frequency(midi_note)))

        return PitchSnapshot(
            frequency=smooth_frequency,
            midi_note=midi_note,
            note_name=midi_to_name(midi_note, turkish=True),
            confidence=confidence,
            rms=rms,
            cents=cents,
            voiced=True,
            timestamp=now,
        )


# -----------------------------------------------------------------------------
# TONALITE VE AKOR MOTORU
# -----------------------------------------------------------------------------

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


class HarmonyEngine:
    """Söylenen melodiyi izleyip kararlı, yumuşak bir eşlik üretir.

    Tonalite değişimleri birkaç saniye doğrulanır. Akorlar yalnızca müzikal
    vuruş sınırlarında değişir; anlık pitch hataları eşliği zıplatmaz.
    """

    def __init__(self, state: RuntimeState) -> None:
        self.state = state
        self.note_weights = np.zeros(12, dtype=np.float64)
        self.recent_notes: Deque[Tuple[float, int, float, float]] = deque(maxlen=180)
        self.onset_times: Deque[float] = deque(maxlen=16)
        self.last_decay = time.monotonic()
        self.last_key_update = 0.0
        self.last_chord_change = 0.0
        self.last_pitch_timestamp = 0.0
        self.last_note: Optional[int] = None
        self.last_note_change = 0.0
        self.previous_degree: Optional[int] = None
        self.previous_voicing: Optional[Tuple[int, ...]] = None
        self.key_candidate: Optional[Tuple[int, str]] = None
        self.key_candidate_since = 0.0
        self.tap_times: Deque[float] = deque(maxlen=8)
        self.started = time.monotonic()

    def tap_tempo(self) -> float:
        now = time.monotonic()
        if self.tap_times and now - self.tap_times[-1] > 2.0:
            self.tap_times.clear()
        self.tap_times.append(now)
        if len(self.tap_times) >= 3:
            intervals = np.diff(np.asarray(self.tap_times, dtype=np.float64))
            median = float(np.median(intervals))
            if 0.25 <= median <= 1.5:
                bpm = clamp(60.0 / median, 50.0, 160.0)
                with self.state.lock:
                    self.state.music.bpm = bpm
                return bpm
        with self.state.lock:
            return self.state.music.bpm

    def adjust_bpm(self, delta: float) -> None:
        with self.state.lock:
            self.state.music.bpm = clamp(self.state.music.bpm + delta, 50.0, 160.0)

    def update(self, pitch: PitchSnapshot) -> None:
        now = time.monotonic()
        elapsed = now - self.last_decay
        self.last_decay = now
        self.note_weights *= math.exp(-elapsed / 10.0)

        if pitch.voiced and pitch.confidence > 0.30 and pitch.timestamp != self.last_pitch_timestamp:
            self.last_pitch_timestamp = pitch.timestamp
            weight = clamp(pitch.confidence, 0.25, 1.0) * clamp(pitch.rms * 18.0, 0.12, 1.0)
            self.note_weights[pitch.midi_note % 12] += weight
            self.recent_notes.append((now, pitch.midi_note, pitch.confidence, pitch.rms))
            if self.last_note is None or abs(pitch.midi_note - self.last_note) >= 1:
                if now - self.last_note_change > 0.13:
                    self.onset_times.append(now)
                    self.last_note_change = now
                self.last_note = pitch.midi_note

        while self.recent_notes and now - self.recent_notes[0][0] > 12.0:
            self.recent_notes.popleft()

        phrase_active = bool(self.recent_notes and now - self.recent_notes[-1][0] < 0.38)
        vocal_center = self._vocal_center()
        if now - self.last_key_update > 0.55:
            self._estimate_key(now)
            self._estimate_tempo()
            self.last_key_update = now

        with self.state.lock:
            bpm = self.state.music.bpm
            self.state.music.beat_phase = ((now - self.started) * bpm / 60.0) % 1.0
            self.state.music.phrase_active = phrase_active
            self.state.music.vocal_center_midi = vocal_center

        # Akor değişimi iki vuruşta bir değerlendirilir. Melodi mevcut akora
        # oturuyorsa dört vuruşa kadar korunur.
        beat_seconds = 60.0 / max(bpm, 1.0)
        minimum_interval = beat_seconds * 2.0
        current_fits = self._current_chord_fits(pitch)
        desired_interval = beat_seconds * (4.0 if current_fits else 2.0)
        if now - self.last_chord_change >= max(minimum_interval, desired_interval):
            self._choose_chord(pitch)
            self.last_chord_change = now

    def _vocal_center(self) -> float:
        if not self.recent_notes:
            with self.state.lock:
                return self.state.music.vocal_center_midi
        notes = [n for t, n, c, r in self.recent_notes if time.monotonic() - t < 6.0]
        return float(np.median(notes)) if notes else 57.0

    def _estimate_tempo(self) -> None:
        if len(self.onset_times) < 4:
            return
        intervals = np.diff(np.asarray(self.onset_times, dtype=np.float64))
        intervals = intervals[(intervals >= 0.24) & (intervals <= 1.35)]
        if intervals.size < 3:
            return
        with self.state.lock:
            current = self.state.music.bpm
        candidates: List[float] = []
        for interval in intervals[-8:]:
            base = 60.0 / float(interval)
            variants = [base / 2.0, base, base * 2.0]
            valid = [v for v in variants if 55.0 <= v <= 145.0]
            if valid:
                candidates.append(min(valid, key=lambda v: abs(v - current)))
        if candidates:
            estimated = float(np.median(candidates))
            with self.state.lock:
                self.state.music.bpm = lerp(current, estimated, 0.10)

    def _estimate_key(self, now: float) -> None:
        total = float(np.sum(self.note_weights))
        if total < 0.65:
            return
        chroma = self.note_weights / max(total, 1e-9)
        candidates: List[Tuple[float, int, str]] = []
        for root in range(12):
            for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
                score = float(np.corrcoef(chroma, np.roll(profile, root))[0, 1])
                if math.isfinite(score):
                    candidates.append((score, root, mode))
        if not candidates:
            return
        candidates.sort(reverse=True, key=lambda item: item[0])
        score, root, mode = candidates[0]
        second = candidates[1][0] if len(candidates) > 1 else -1.0
        confidence = clamp((score - second + 0.10) / 0.32, 0.0, 1.0)
        candidate = (root, mode)
        with self.state.lock:
            current = (self.state.music.key_root, self.state.music.mode)
        if candidate != current:
            if self.key_candidate != candidate:
                self.key_candidate = candidate
                self.key_candidate_since = now
                return
            if confidence < 0.28 or now - self.key_candidate_since < 2.2:
                return
        suffix = "MAJOR" if mode == "major" else "MINOR"
        with self.state.lock:
            self.state.music.key_root = root
            self.state.music.mode = mode
            self.state.music.key_name = f"{NOTE_NAMES[root]} {suffix}"
            self.state.music.key_confidence = confidence

    @staticmethod
    def _scale_intervals(mode: str) -> Sequence[int]:
        return (0, 2, 4, 5, 7, 9, 11) if mode == "major" else (0, 2, 3, 5, 7, 8, 10)

    def _diatonic_triads(self, root: int, mode: str) -> List[Tuple[str, Tuple[int, int, int], int, int]]:
        scale = self._scale_intervals(mode)
        base_midi = 48 + root  # C3 çevresi; vokalin altında kalır.
        triads: List[Tuple[str, Tuple[int, int, int], int, int]] = []
        for degree in range(7):
            notes: List[int] = []
            for offset in (0, 2, 4):
                absolute_degree = degree + offset
                note = base_midi + scale[absolute_degree % 7] + (12 if absolute_degree >= 7 else 0)
                notes.append(note)
            semis = ((notes[1] - notes[0]) % 12, (notes[2] - notes[1]) % 12)
            quality = "" if semis == (4, 3) else ("m" if semis == (3, 4) else ("dim" if semis == (3, 3) else ""))
            chord_root_pc = notes[0] % 12
            triads.append((f"{NOTE_NAMES[chord_root_pc]}{quality}", tuple(notes), chord_root_pc, degree))
        return triads

    def _recent_pc_weights(self, seconds: float = 2.8) -> np.ndarray:
        now = time.monotonic()
        weights = np.zeros(12, dtype=np.float64)
        for t, note, confidence, rms in self.recent_notes:
            age = now - t
            if age <= seconds:
                weights[note % 12] += confidence * math.exp(-age / 1.7) * clamp(rms * 18.0, 0.2, 1.0)
        return weights

    def _current_chord_fits(self, pitch: PitchSnapshot) -> bool:
        if not pitch.voiced:
            return True
        with self.state.lock:
            pcs = {n % 12 for n in self.state.music.chord_notes}
        return pitch.midi_note % 12 in pcs

    def _voice_below_vocal(self, notes: Tuple[int, int, int], vocal_center: float) -> Tuple[int, ...]:
        voiced = list(notes)
        target_top = int(vocal_center - 4)
        while max(voiced) > target_top:
            voiced = [n - 12 for n in voiced]
        while max(voiced) < target_top - 17:
            voiced = [n + 12 for n in voiced]
        # En küçük hareketi seçmek için birkaç inversion dene.
        variants: List[Tuple[int, ...]] = []
        for inv in range(3):
            v = list(voiced)
            for i in range(inv):
                v[i] += 12
            v = sorted(v)
            while max(v) > target_top:
                v = [n - 12 for n in v]
            variants.append(tuple(v))
        if self.previous_voicing is None:
            return min(variants, key=lambda v: abs(max(v) - target_top))
        return min(variants, key=lambda v: sum(abs(a - b) for a, b in zip(v, self.previous_voicing)))

    def _choose_chord(self, pitch: PitchSnapshot) -> None:
        with self.state.lock:
            root = self.state.music.key_root
            mode = self.state.music.mode
            vocal_center = self.state.music.vocal_center_midi
        triads = self._diatonic_triads(root, mode)
        recent = self._recent_pc_weights()
        melody_pc = pitch.midi_note % 12 if pitch.voiced else root

        # Basit fakat kararlı işlev geçişleri.
        transitions = {
            0: {0: 0.7, 3: 0.5, 4: 0.9, 5: 0.4},
            1: {4: 0.8, 6: 0.3},
            2: {5: 0.7, 3: 0.4},
            3: {0: 0.8, 1: 0.4, 4: 0.6},
            4: {0: 1.1, 5: 0.3},
            5: {1: 0.5, 3: 0.6, 4: 0.8},
            6: {0: 0.8},
        }

        best_score = -1e9
        best = triads[0]
        for name, notes, chord_root, degree in triads:
            pcs = {n % 12 for n in notes}
            score = 3.2 if melody_pc in pcs else -1.15
            score += sum(float(recent[pc]) for pc in pcs) * 0.48
            score += 0.95 if degree == 0 else 0.0
            score += 0.42 if degree in (3, 4, 5) else 0.0
            if self.previous_degree is not None:
                score += transitions.get(self.previous_degree, {}).get(degree, 0.0)
                if degree == self.previous_degree:
                    score -= 0.24
            if self.previous_voicing is not None:
                candidate_voicing = self._voice_below_vocal(notes, vocal_center)
                score -= sum(abs(a - b) for a, b in zip(candidate_voicing, self.previous_voicing)) * 0.025
            if score > best_score:
                best_score = score
                best = (name, notes, chord_root, degree)

        name, notes, _, degree = best
        voiced = self._voice_below_vocal(notes, vocal_center)
        self.previous_degree = degree
        changed = voiced != self.previous_voicing
        self.previous_voicing = voiced
        confidence = clamp((best_score + 1.0) / 6.0, 0.0, 1.0)
        with self.state.lock:
            self.state.music.chord_name = name
            self.state.music.chord_notes = voiced
            self.state.music.accompaniment_confidence = confidence
            if changed:
                self.state.music.chord_revision += 1


# -----------------------------------------------------------------------------
# VOKAL EFEKT ZINCIRI
# -----------------------------------------------------------------------------

class VocalDSP:
    """Dusuk gecikmeli temel vokal zinciri.

    Bu sinif harici VST gerektirmeden high-pass, hafif noise gate,
    compressor, stereo reverb benzeri coklu gecikme, echo ve limiter saglar.
    """

    def __init__(self, sample_rate: int = AUDIO_SR) -> None:
        self.sample_rate = sample_rate
        self.enabled = True
        self.monitor_enabled = True
        self.noise_reduction = 0.30
        self.compression = 0.42
        self.clarity = 0.15
        self.warmth = 0.12
        self.reverb_mix = 0.11
        self.echo_mix = 0.04
        self.output_gain = 0.82

        self.low_state = 0.0
        self.comp_gain = 1.0
        self.gate_gain = 1.0
        self.delay_size = int(sample_rate * 2.2)
        self.delay_l = np.zeros(self.delay_size, dtype=np.float32)
        self.delay_r = np.zeros(self.delay_size, dtype=np.float32)
        self.delay_pos = 0
        self.echo_samples = int(sample_rate * 0.118)
        self.reverb_taps_l = [int(sample_rate * x) for x in (0.037, 0.071, 0.113, 0.167)]
        self.reverb_taps_r = [int(sample_rate * x) for x in (0.043, 0.079, 0.131, 0.181)]
        self.feedback_lpf_l = 0.0
        self.feedback_lpf_r = 0.0

    def set_fx_amount(self, amount: float) -> None:
        amount = clamp(amount, 0.0, 1.0)
        self.reverb_mix = lerp(0.05, 0.24, amount)
        self.echo_mix = lerp(0.01, 0.095, amount)

    def process(self, mono: np.ndarray) -> np.ndarray:
        x = np.asarray(mono, dtype=np.float32)
        frames = len(x)
        if frames == 0:
            return np.zeros((0, 2), dtype=np.float32)

        # Yaklasik 80 Hz high-pass. Tek kutuplu LP cikarimi.
        cutoff = 80.0
        alpha = math.exp(-2.0 * math.pi * cutoff / self.sample_rate)
        hp = np.empty_like(x)
        low = self.low_state
        for i, sample in enumerate(x):
            low = (1.0 - alpha) * float(sample) + alpha * low
            hp[i] = float(sample) - low
        self.low_state = low

        rms = float(np.sqrt(np.mean(hp * hp) + 1e-12))
        gate_threshold = lerp(0.0018, 0.010, self.noise_reduction)
        target_gate = 1.0 if rms >= gate_threshold else 0.18
        gate_speed = 0.22 if target_gate > self.gate_gain else 0.06
        self.gate_gain += (target_gate - self.gate_gain) * gate_speed
        clean = hp * self.gate_gain

        # Block tabanli compressor. Vokal karakterini ezmeyecek kadar yumusak.
        threshold = lerp(0.18, 0.055, self.compression)
        ratio = lerp(1.4, 3.4, self.compression)
        peak = float(np.max(np.abs(clean)) + 1e-9)
        if peak > threshold:
            compressed_peak = threshold + (peak - threshold) / ratio
            target_gain = compressed_peak / peak
        else:
            target_gain = 1.0
        coeff = 0.30 if target_gain < self.comp_gain else 0.07
        self.comp_gain += (target_gain - self.comp_gain) * coeff
        clean *= self.comp_gain

        # Hafif presence ve warmth. Ayri filtre yerine guvenli dogrusal olmayan tema.
        presence = clean - np.concatenate(([clean[0]], clean[:-1]))
        clean = clean + presence * self.clarity * 0.18
        clean = np.tanh(clean * (1.0 + self.warmth * 0.55)) / (1.0 + self.warmth * 0.30)

        if not self.enabled:
            stereo = np.column_stack((clean, clean))
            return np.clip(stereo * self.output_gain, -0.96, 0.96).astype(np.float32)

        idx = (np.arange(frames, dtype=np.int64) + self.delay_pos) % self.delay_size
        wet_l = np.zeros(frames, dtype=np.float32)
        wet_r = np.zeros(frames, dtype=np.float32)

        for tap, gain in zip(self.reverb_taps_l, (0.44, 0.31, 0.22, 0.16)):
            wet_l += self.delay_l[(idx - tap) % self.delay_size] * gain
        for tap, gain in zip(self.reverb_taps_r, (0.42, 0.30, 0.23, 0.15)):
            wet_r += self.delay_r[(idx - tap) % self.delay_size] * gain

        echo_l = self.delay_l[(idx - self.echo_samples) % self.delay_size]
        echo_r = self.delay_r[(idx - int(self.echo_samples * 1.07)) % self.delay_size]

        # Geri beslemeyi hafif low-pass ile yumusat.
        feedback_l = 0.36 * wet_l + 0.09 * echo_l
        feedback_r = 0.36 * wet_r + 0.09 * echo_r
        smooth_l = np.empty_like(feedback_l)
        smooth_r = np.empty_like(feedback_r)
        lp_l = self.feedback_lpf_l
        lp_r = self.feedback_lpf_r
        for i in range(frames):
            lp_l = 0.23 * float(feedback_l[i]) + 0.77 * lp_l
            lp_r = 0.23 * float(feedback_r[i]) + 0.77 * lp_r
            smooth_l[i] = lp_l
            smooth_r[i] = lp_r
        self.feedback_lpf_l = lp_l
        self.feedback_lpf_r = lp_r

        self.delay_l[idx] = np.clip(clean + smooth_r, -1.2, 1.2)
        self.delay_r[idx] = np.clip(clean + smooth_l, -1.2, 1.2)
        self.delay_pos = int((self.delay_pos + frames) % self.delay_size)

        left = clean + wet_l * self.reverb_mix + echo_l * self.echo_mix
        right = clean + wet_r * self.reverb_mix + echo_r * self.echo_mix
        stereo = np.column_stack((left, right)) * self.output_gain
        # Yumusak limiter.
        stereo = np.tanh(stereo * 1.18) / math.tanh(1.18)
        return np.clip(stereo, -0.96, 0.96).astype(np.float32)


# -----------------------------------------------------------------------------
# ESLIK SYNTH VE SEQUENCER
# -----------------------------------------------------------------------------

@dataclass
class Voice:
    midi_note: int
    kind: str
    velocity: float
    duration_samples: int
    pan: float = 0.0
    phase: float = 0.0
    age_samples: int = 0
    seed: int = 0


class SynthEngine:
    """Vokalin altında kalan, side-chain ducking kullanan hafif eşlik synth'i."""

    def __init__(self, state: RuntimeState, sample_rate: int = AUDIO_SR) -> None:
        self.state = state
        self.sample_rate = sample_rate
        self.voices: List[Voice] = []
        self.voice_lock = threading.RLock()
        self.step_index = 0
        self.samples_to_step = 0.0
        self.music_gain = 0.27
        self.density = 0.38
        self.duck_gain = 0.62
        self.last_chord_revision = -1
        self.max_voices = 44

    def set_layers(self, layers: Iterable[str]) -> None:
        with self.state.lock:
            self.state.active_layers = set(layers) | {"PIANO"}

    def toggle_layer(self, layer: str) -> bool:
        with self.state.lock:
            layers = set(self.state.active_layers)
            if layer in layers:
                layers.remove(layer)
                active = False
            else:
                layers.add(layer)
                active = True
            layers.add("PIANO")
            self.state.active_layers = layers
        return active

    def mute_extras(self) -> None:
        self.set_layers({"PIANO"})

    def full_orchestra(self) -> None:
        self.set_layers({"PIANO", "STRINGS", "BASS", "DRUMS", "PAD"})

    def adjust_music_gain(self, delta: float) -> float:
        self.music_gain = clamp(self.music_gain + delta, 0.08, 0.46)
        return self.music_gain

    def trigger(self, midi_note: int, kind: str, velocity: float = 0.7, duration: float = 0.8, pan: float = 0.0) -> None:
        if velocity <= 0.001:
            return
        voice = Voice(
            midi_note=int(midi_note), kind=kind,
            velocity=clamp(velocity, 0.0, 1.0),
            duration_samples=max(64, int(duration * self.sample_rate)),
            pan=clamp(pan, -1.0, 1.0),
            seed=random.randint(0, 2**31 - 1),
        )
        with self.voice_lock:
            if len(self.voices) >= self.max_voices:
                self.voices = self.voices[-(self.max_voices - 1):]
            self.voices.append(voice)

    def _schedule_step(self) -> None:
        with self.state.lock:
            music = MusicSnapshot(**vars(self.state.music))
            layers = set(self.state.active_layers)
        chord = list(music.chord_notes)
        if not chord:
            return
        step = self.step_index % 8
        beat_seconds = 60.0 / max(music.bpm, 1.0)
        phrase_active = music.phrase_active
        chord_changed = music.chord_revision != self.last_chord_revision
        if chord_changed:
            self.last_chord_revision = music.chord_revision

        # Şarkı söylenirken seyrek ve düşük seviyeli; nefes boşluklarında biraz daha dolu.
        if "PIANO" in layers:
            active_steps = (0, 2, 4, 6) if phrase_active else (0, 1, 2, 4, 5, 6)
            if step in active_steps:
                pattern = (0, 1, 2, 1, 0, 2, 1, 2)
                note = chord[pattern[step] % len(chord)]
                velocity = 0.30 if phrase_active else 0.38
                self.trigger(note, "piano", velocity, beat_seconds * 0.68, pan=-0.08 + 0.16 * (step / 7.0))
            if chord_changed and step in (0, 4):
                for idx, n in enumerate(chord):
                    self.trigger(n, "piano_soft", 0.15 if phrase_active else 0.21, beat_seconds * 1.45, pan=(-0.18 + idx * 0.18))

        if "BASS" in layers and step in (0, 4):
            self.trigger(chord[0] - 12, "bass", 0.30 if phrase_active else 0.38, beat_seconds * 0.90, pan=-0.06)

        if "STRINGS" in layers and chord_changed and step in (0, 4):
            for idx, note in enumerate(chord):
                self.trigger(note, "strings", 0.105, beat_seconds * 3.6, pan=(-0.45 + idx * 0.45))

        if "PAD" in layers and chord_changed and step in (0, 4):
            for idx, note in enumerate(chord):
                self.trigger(note - 12, "pad", 0.075, beat_seconds * 3.8, pan=(-0.58 + idx * 0.58))

        if "DRUMS" in layers:
            self.trigger(36, "kick", 0.24 if step in (0, 4) else 0.0, 0.18)
            if step in (2, 6):
                self.trigger(38, "snare", 0.18, 0.17)
            if step % 2 == 0:
                self.trigger(42, "hat", 0.07, 0.08, pan=0.18)

        self.step_index += 1

    def render(self, frames: int) -> np.ndarray:
        with self.state.lock:
            bpm = self.state.music.bpm
            vocal_level = self.state.vocal_level
            phrase_active = self.state.music.phrase_active
        samples_per_step = self.sample_rate * 60.0 / max(bpm, 1.0) / 2.0
        self.samples_to_step -= frames
        while self.samples_to_step <= 0.0:
            self._schedule_step()
            self.samples_to_step += samples_per_step

        output = np.zeros((frames, 2), dtype=np.float32)
        with self.voice_lock:
            active: List[Voice] = []
            for voice in self.voices:
                if voice.velocity <= 0.0 or voice.age_samples >= voice.duration_samples:
                    continue
                output += self._render_voice(voice, frames)
                if voice.age_samples < voice.duration_samples:
                    active.append(voice)
            self.voices = active

        # Vokal aktifken piyano otomatik olarak yaklaşık 7-10 dB geri çekilir.
        target_duck = 0.44 if (phrase_active or vocal_level > 0.009) else 0.74
        self.duck_gain += (target_duck - self.duck_gain) * 0.12
        output *= self.music_gain * self.duck_gain
        return np.clip(output, -0.72, 0.72)

    def _render_voice(self, voice: Voice, frames: int) -> np.ndarray:
        n = np.arange(frames, dtype=np.float64) + voice.age_samples
        t = n / self.sample_rate
        frequency = midi_to_frequency(voice.midi_note)
        phase = voice.phase + 2.0 * math.pi * frequency * (np.arange(frames) / self.sample_rate)
        age = n / self.sample_rate
        duration = voice.duration_samples / self.sample_rate

        if voice.kind in ("piano", "piano_soft"):
            attack = np.minimum(1.0, age / 0.010)
            decay_rate = 4.1 if voice.kind == "piano" else 2.5
            env = attack * np.exp(-age * decay_rate)
            signal = (np.sin(phase) + 0.28 * np.sin(phase * 2.01 + 0.2) + 0.10 * np.sin(phase * 3.99 + 0.5)) / 1.38
        elif voice.kind == "bass":
            env = np.minimum(1.0, age / 0.018) * np.exp(-age * 3.0)
            signal = 0.86 * np.sin(phase) + 0.14 * np.sin(phase * 2.0)
        elif voice.kind in ("strings", "pad"):
            attack_time = 0.32 if voice.kind == "strings" else 0.62
            release_time = 0.62
            env = np.minimum(1.0, age / attack_time) * np.minimum(1.0, np.maximum(0.0, duration - age) / release_time)
            vibrato = 0.0025 * np.sin(2.0 * math.pi * 4.8 * t)
            phase_v = phase + vibrato
            signal = sum((1.0 / h) * np.sin(phase_v * h) for h in range(1, 5)) / 1.95
            if voice.kind == "pad":
                signal = 0.72 * signal + 0.28 * np.sin(phase * 0.5)
        elif voice.kind == "kick":
            env = np.exp(-age * 23.0)
            swept = 2.0 * math.pi * (50.0 * age + 43.0 * (1.0 - np.exp(-age * 19.0)))
            signal = np.sin(swept)
        elif voice.kind == "snare":
            rng = np.random.default_rng(voice.seed + voice.age_samples)
            env = np.exp(-age * 29.0)
            signal = 0.74 * rng.standard_normal(frames) + 0.26 * np.sin(phase * 0.42)
        elif voice.kind == "hat":
            rng = np.random.default_rng(voice.seed + voice.age_samples)
            env = np.exp(-age * 52.0)
            noise = rng.standard_normal(frames)
            signal = noise - np.concatenate(([noise[0]], noise[:-1]))
        else:
            env = np.exp(-age * 3.0)
            signal = np.sin(phase)

        signal = np.asarray(signal * env * voice.velocity, dtype=np.float32)
        voice.phase = float((phase[-1] + 2.0 * math.pi * frequency / self.sample_rate) % (2.0 * math.pi))
        voice.age_samples += frames
        left_gain = math.sqrt((1.0 - voice.pan) * 0.5)
        right_gain = math.sqrt((1.0 + voice.pan) * 0.5)
        return np.column_stack((signal * left_gain, signal * right_gain)).astype(np.float32)


# -----------------------------------------------------------------------------
# AUDIO ENGINE
# -----------------------------------------------------------------------------

class AudioEngine:
    def __init__(self, state: RuntimeState) -> None:
        self.state = state
        self.pitch_tracker = PitchTracker(state)
        self.harmony = HarmonyEngine(state)
        self.dsp = VocalDSP()
        self.synth = SynthEngine(state)
        self.stream = None
        self.running = False
        self.last_callback_time = 0.0
        self.callback_errors: Deque[str] = deque(maxlen=4)

    def start(self) -> bool:
        if not SOUNDDEVICE_AVAILABLE:
            with self.state.lock:
                self.state.audio_status = "SOUNDDEVICE YOK"
            return False
        if self.running:
            return True
        try:
            self.pitch_tracker.start()
            self.stream = sd.Stream(
                samplerate=AUDIO_SR,
                blocksize=AUDIO_BLOCK,
                dtype="float32",
                channels=(AUDIO_CHANNELS_IN, AUDIO_CHANNELS_OUT),
                latency="low",
                callback=self._callback,
            )
            self.stream.start()
            self.running = True
            with self.state.lock:
                self.state.audio_status = "MIC + VOCAL FX ONLINE"
            return True
        except Exception as exc:  # pragma: no cover - donanim bagimliligi
            self.callback_errors.append(str(exc))
            with self.state.lock:
                self.state.audio_status = f"AUDIO ERROR: {str(exc)[:34]}"
            return False

    def stop(self) -> None:
        self.running = False
        self.pitch_tracker.stop()
        try:
            if self.stream is not None:
                self.stream.stop()
                self.stream.close()
        except Exception:
            pass
        self.stream = None

    def _callback(self, indata, outdata, frames, time_info, status) -> None:  # pragma: no cover - gercek zamanli
        started = time.perf_counter()
        try:
            mono = np.asarray(indata[:, 0], dtype=np.float32)
            self.pitch_tracker.submit(mono)

            vocal_level = float(np.sqrt(np.mean(mono * mono) + 1e-12))
            waveform = mono
            if len(mono) != 256:
                positions = np.linspace(0, len(mono) - 1, 256)
                waveform = np.interp(positions, np.arange(len(mono)), mono).astype(np.float32)

            if self.dsp.monitor_enabled:
                vocal = self.dsp.process(mono)
            else:
                vocal = np.zeros((frames, 2), dtype=np.float32)
            music = self.synth.render(frames)
            mix = vocal * 0.96 + music
            mix = np.tanh(mix * 1.06) / math.tanh(1.06)
            mix = np.clip(mix, -0.96, 0.96).astype(np.float32)
            outdata[:] = mix

            output_level = float(np.sqrt(np.mean(mix * mix) + 1e-12))
            callback_ms = (time.perf_counter() - started) * 1000.0
            with self.state.lock:
                self.state.vocal_level = vocal_level
                self.state.output_level = output_level
                self.state.waveform = waveform
                self.state.latency_ms = callback_ms + AUDIO_BLOCK / AUDIO_SR * 1000.0
                if status:
                    self.state.audio_status = f"AUDIO WARN: {status}"
        except Exception as exc:
            outdata.fill(0)
            self.callback_errors.append(str(exc))
            with self.state.lock:
                self.state.audio_status = f"CALLBACK ERROR: {str(exc)[:30]}"

    def update_harmony(self) -> None:
        with self.state.lock:
            pitch = PitchSnapshot(**vars(self.state.pitch))
        self.harmony.update(pitch)


# -----------------------------------------------------------------------------
# EL TAKIBI VE JEST MOTORU
# -----------------------------------------------------------------------------

class CameraWorker(threading.Thread):
    """Kamerayı arayüzden bağımsız okur ve yalnızca en yeni kareyi saklar."""

    def __init__(self, index: int, width: int, height: int, fps: int, state: RuntimeState) -> None:
        super().__init__(daemon=True, name="CameraWorker")
        self.index = index
        self.width = width
        self.height = height
        self.fps = fps
        self.state = state
        self.cap: Optional[cv2.VideoCapture] = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.latest: Optional[np.ndarray] = None
        self.frame_id = 0
        self.last_error = ""
        self.opened = threading.Event()

    def _open(self) -> bool:
        backend = cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY
        cap = cv2.VideoCapture(self.index, backend)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        try:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        except Exception:
            pass
        if not cap.isOpened():
            cap.release()
            return False
        self.cap = cap
        return True

    def run(self) -> None:
        if not self._open():
            self.last_error = "Kamera açılamadı"
            with self.state.lock:
                self.state.camera_status = "CAMERA ERROR"
            self.opened.set()
            return
        self.opened.set()
        with self.state.lock:
            self.state.camera_status = "CAMERA ONLINE"
        count = 0
        measured_at = time.perf_counter()
        while not self.stop_event.is_set():
            ok, frame = self.cap.read() if self.cap is not None else (False, None)
            if not ok or frame is None:
                self.last_error = "Kamera karesi alınamadı"
                time.sleep(0.01)
                continue
            with self.lock:
                self.latest = frame
                self.frame_id += 1
            count += 1
            now = time.perf_counter()
            if now - measured_at >= 0.75:
                fps = count / max(now - measured_at, 1e-6)
                with self.state.lock:
                    self.state.camera_fps = fps
                count = 0
                measured_at = now
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def get_latest(self, after_id: int = -1) -> Tuple[Optional[np.ndarray], int]:
        with self.lock:
            if self.latest is None or self.frame_id == after_id:
                return None, self.frame_id
            return self.latest.copy(), self.frame_id

    def stop(self) -> None:
        self.stop_event.set()
        self.join(timeout=1.2)


@dataclass
class HandPacket:
    label: str
    landmarks: List[Point]
    normalized: List[Tuple[float, float, float]]
    gesture: str
    confidence: float
    openness: float
    pinch: float
    fingers: Tuple[bool, bool, bool, bool, bool]
    palm_center: Point
    hand_size: float


class HandTracker:
    """Düşük çözünürlükte ve seyrek çalışan, sonuçları kareler arasında koruyan takipçi."""

    def __init__(self, process_width: int = HAND_PROCESS_WIDTH, process_every: int = 2) -> None:
        self.available = MP_AVAILABLE
        self.hands = None
        self.process_width = max(256, int(process_width))
        self.process_every = max(1, int(process_every))
        self.frame_index = 0
        self.last_packets: List[HandPacket] = []
        self.last_detection_time = 0.0
        self.detector_times: Deque[float] = deque(maxlen=20)
        self.histories: Dict[str, Deque[str]] = {"LEFT": deque(maxlen=5), "RIGHT": deque(maxlen=5)}
        self.smooth_landmarks: Dict[str, np.ndarray] = {}
        if self.available:
            try:
                self.mp_hands = mp.solutions.hands
                self.hands = self.mp_hands.Hands(
                    static_image_mode=False,
                    max_num_hands=MAX_HANDS,
                    model_complexity=0,
                    min_detection_confidence=0.58,
                    min_tracking_confidence=0.50,
                )
            except Exception:
                self.available = False
                self.hands = None

    def close(self) -> None:
        if self.hands is not None:
            self.hands.close()

    def process(self, frame_bgr: np.ndarray) -> List[HandPacket]:
        self.frame_index += 1
        if not self.available or self.hands is None:
            return []
        if self.frame_index % self.process_every != 0:
            return self.last_packets

        started = time.perf_counter()
        h, w = frame_bgr.shape[:2]
        small_h = max(144, int(h * self.process_width / w))
        small = cv2.resize(frame_bgr, (self.process_width, small_h), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        result = self.hands.process(rgb)
        packets: List[HandPacket] = []

        if result.multi_hand_landmarks:
            handedness = result.multi_handedness or []
            for idx, hand_lms in enumerate(result.multi_hand_landmarks):
                label = "RIGHT"
                confidence = 0.0
                if idx < len(handedness):
                    cls = handedness[idx].classification[0]
                    label = str(cls.label).upper()
                    confidence = float(cls.score)
                normalized_raw = np.asarray([(float(lm.x), float(lm.y), float(lm.z)) for lm in hand_lms.landmark], dtype=np.float32)
                previous = self.smooth_landmarks.get(label)
                normalized_arr = normalized_raw if previous is None else previous * 0.52 + normalized_raw * 0.48
                self.smooth_landmarks[label] = normalized_arr
                normalized = [tuple(map(float, row)) for row in normalized_arr]
                points = [(int(clamp(x, 0.0, 1.0) * w), int(clamp(y, 0.0, 1.0) * h)) for x, y, _ in normalized]
                packet = self._build_packet(label, confidence, points, normalized)
                self.histories.setdefault(label, deque(maxlen=5)).append(packet.gesture)
                packet.gesture = self._stable_gesture(label, packet.gesture)
                packets.append(packet)
            self.last_detection_time = time.monotonic()
        elif time.monotonic() - self.last_detection_time < 0.18:
            packets = self.last_packets

        self.last_packets = packets
        elapsed = time.perf_counter() - started
        if elapsed > 0:
            self.detector_times.append(1.0 / elapsed)
        return packets

    @property
    def detector_fps(self) -> float:
        return float(np.mean(self.detector_times)) if self.detector_times else 0.0

    def _stable_gesture(self, label: str, fallback: str) -> str:
        history = self.histories.get(label)
        if not history:
            return fallback
        counts: Dict[str, int] = {}
        for item in history:
            counts[item] = counts.get(item, 0) + 1
        gesture, count = max(counts.items(), key=lambda item: item[1])
        return gesture if count >= 3 else fallback

    def _build_packet(self, label: str, confidence: float, points: List[Point], normalized: List[Tuple[float, float, float]]) -> HandPacket:
        palm_indices = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]
        palm_center = (int(np.mean([points[i][0] for i in palm_indices])), int(np.mean([points[i][1] for i in palm_indices])))
        hand_size = max(20.0, dist(points[WRIST], points[MIDDLE_MCP]) * 1.9)
        non_thumb = (
            points[INDEX_TIP][1] < points[INDEX_PIP][1],
            points[MIDDLE_TIP][1] < points[MIDDLE_PIP][1],
            points[RING_TIP][1] < points[RING_PIP][1],
            points[PINKY_TIP][1] < points[PINKY_PIP][1],
        )
        thumb_extended = dist(points[THUMB_TIP], palm_center) > dist(points[THUMB_IP], palm_center) * 1.13
        fingers = (thumb_extended,) + non_thumb
        open_count = sum(bool(v) for v in fingers)
        pinch = dist(points[THUMB_TIP], points[INDEX_TIP]) / hand_size
        openness = float(np.mean([dist(points[i], palm_center) for i in (THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP)]) / hand_size)
        if pinch < 0.26:
            gesture = "PINCH"
        elif non_thumb[0] and non_thumb[1] and not non_thumb[2] and not non_thumb[3]:
            gesture = "PEACE"
        elif non_thumb[0] and not any(non_thumb[1:]):
            gesture = "POINT"
        elif open_count >= 4:
            gesture = "OPEN_HAND"
        elif open_count <= 1 and not non_thumb[0]:
            gesture = "FIST"
        else:
            gesture = "NEUTRAL"
        return HandPacket(label, points, normalized, gesture, confidence, openness, pinch, fingers, palm_center, hand_size)


class GestureController:
    def __init__(self, state: RuntimeState, audio: AudioEngine) -> None:
        self.state = state
        self.audio = audio
        self.last_event: Dict[str, float] = {}
        self.dual_open_since: Optional[float] = None
        self.layer_cursor = 0
        self.layer_order = ["STRINGS", "PAD", "BASS", "DRUMS"]

    def _allowed(self, event: str, cooldown: float = 1.1) -> bool:
        now = time.time()
        previous = self.last_event.get(event, 0.0)
        if now - previous < cooldown:
            return False
        self.last_event[event] = now
        return True

    def update(self, hands: Sequence[HandPacket]) -> None:
        if not hands:
            with self.state.lock:
                self.state.gesture = "SCANNING"
                self.state.gesture_detail = "ELLER BEKLENIYOR"
            self.dual_open_since = None
            return

        open_hands = [hand for hand in hands if hand.gesture == "OPEN_HAND"]
        if len(open_hands) >= 2:
            if self.dual_open_since is None:
                self.dual_open_since = time.time()
            held = time.time() - self.dual_open_since
            with self.state.lock:
                self.state.gesture = "DUAL OPEN"
                self.state.gesture_detail = f"FULL ORCHESTRA ARMING {held:0.1f}s"
            if held > 0.55 and self._allowed("DUAL_OPEN", 2.0):
                self.audio.synth.full_orchestra()
                with self.state.lock:
                    self.state.gesture_detail = "TAM ORKESTRA AKTIF"
            self._map_hand_distance(open_hands[0], open_hands[1])
            return
        self.dual_open_since = None

        # Oncelik pinch'e verilir; efekt miktari surekli kontrol edilir.
        pinches = [hand for hand in hands if hand.gesture == "PINCH"]
        if pinches:
            hand = pinches[0]
            amount = clamp((0.55 - hand.pinch) / 0.42, 0.0, 1.0)
            self.audio.dsp.set_fx_amount(amount)
            with self.state.lock:
                self.state.gesture = f"{hand.label} PINCH"
                self.state.gesture_detail = f"VOCAL SPACE {int(amount * 100):02d}%"
            return

        hand = max(hands, key=lambda item: item.confidence)
        gesture = hand.gesture
        with self.state.lock:
            self.state.gesture = f"{hand.label} {gesture}"

        if gesture == "OPEN_HAND":
            target = "STRINGS" if hand.label == "RIGHT" else "PAD"
            if self._allowed(f"OPEN_{hand.label}", 1.4):
                with self.state.lock:
                    layers = set(self.state.active_layers)
                if target not in layers:
                    self.audio.synth.toggle_layer(target)
            with self.state.lock:
                self.state.gesture_detail = f"{target} KATMANI ACIK"
        elif gesture == "PEACE":
            if self._allowed(f"PEACE_{hand.label}"):
                active = self.audio.synth.toggle_layer("DRUMS")
                detail = "DRUMS AKTIF" if active else "DRUMS KAPALI"
            else:
                detail = "RITIM KOMUTU KILITLI"
            with self.state.lock:
                self.state.gesture_detail = detail
        elif gesture == "FIST":
            if self._allowed(f"FIST_{hand.label}"):
                self.audio.synth.mute_extras()
            with self.state.lock:
                self.state.gesture_detail = "EK KATMANLAR SUSTURULDU"
        elif gesture == "POINT":
            if self._allowed(f"POINT_{hand.label}"):
                layer = self.layer_order[self.layer_cursor % len(self.layer_order)]
                self.layer_cursor += 1
                active = self.audio.synth.toggle_layer(layer)
                detail = f"{layer} {'AKTIF' if active else 'KAPALI'}"
            else:
                detail = "KATMAN SECIMI"
            with self.state.lock:
                self.state.gesture_detail = detail
        else:
            with self.state.lock:
                self.state.gesture_detail = "HAREKET IZLENIYOR"

    def _map_hand_distance(self, left: HandPacket, right: HandPacket) -> None:
        d = dist(left.palm_center, right.palm_center)
        screen_width = CAM_WIDTH
        normalized = clamp((d / screen_width - 0.12) / 0.52, 0.0, 1.0)
        self.audio.synth.density = lerp(0.24, 0.62, normalized)
        self.audio.synth.music_gain = lerp(0.19, 0.35, normalized)


# -----------------------------------------------------------------------------
# HUD RENDERER
# -----------------------------------------------------------------------------

class HUDRenderer:
    """Soft, modern camera UI without sci-fi HUD decoration."""

    def __init__(self, state: RuntimeState, audio: AudioEngine) -> None:
        self.state = state
        self.audio = audio
        self.theme_index = 0
        self.hud_enabled = True
        self.start_time = time.time()
        self.fps_history: Deque[float] = deque(maxlen=80)
        self.ambient_cache: Dict[Tuple[int, int, int], np.ndarray] = {}

    @property
    def theme(self) -> Theme:
        return THEMES[self.theme_index % len(THEMES)]

    def cycle_theme(self, index: int) -> None:
        self.theme_index = int(clamp(index, 0, len(THEMES) - 1))

    def update_fps(self, fps: float) -> None:
        self.fps_history.append(fps)

    def render(self, frame: np.ndarray, hands: Sequence[HandPacket]) -> np.ndarray:
        img = self._soft_grade(frame)
        self._draw_ambient_wash(img)
        self._draw_hand_skeletons(img, hands)

        if self.hud_enabled:
            self._draw_header(img)
            self._draw_vocal_card(img)
            self._draw_music_card(img)
            self._draw_orchestra_card(img)
            self._draw_bottom_deck(img)
        return img

    def _soft_grade(self, frame: np.ndarray) -> np.ndarray:
        # convertScaleAbs, tam-kare float dönüşümünden daha ucuzdur.
        return cv2.convertScaleAbs(frame, alpha=0.93, beta=18)

    def _draw_ambient_wash(self, img: np.ndarray) -> None:
        theme = self.theme
        h, w = img.shape[:2]
        key = (self.theme_index, w, h)
        overlay = self.ambient_cache.get(key)
        if overlay is None:
            sw, sh = max(160, w // 4), max(90, h // 4)
            small = np.zeros((sh, sw, 3), dtype=np.uint8)
            cv2.circle(small, (int(sw * 0.14), int(sh * 0.22)), int(sw * 0.23), theme.secondary, -1, cv2.LINE_AA)
            cv2.circle(small, (int(sw * 0.83), int(sh * 0.30)), int(sw * 0.25), theme.primary, -1, cv2.LINE_AA)
            cv2.circle(small, (int(sw * 0.54), int(sh * 0.95)), int(sw * 0.28), theme.accent, -1, cv2.LINE_AA)
            small = cv2.GaussianBlur(small, (0, 0), 22)
            overlay = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
            self.ambient_cache[key] = overlay
        cv2.addWeighted(overlay, 0.075, img, 0.925, 0, img)

    def _soft_card(self, img: np.ndarray, x: int, y: int, w: int, h: int, alpha: float = 0.86, radius: int = 24) -> None:
        theme = self.theme
        # Bulanık gölge her karede hesaplanmıyor. Hafif ofset yüzey yeterli.
        shadow = img.copy()
        rounded_rect(shadow, (x + 4, y + 5), (x + w + 4, y + h + 5), theme.muted, radius=radius, thickness=-1)
        alpha_blend(img, shadow, 0.05)
        overlay = img.copy()
        rounded_rect(overlay, (x, y), (x + w, y + h), theme.panel, radius=radius, thickness=-1)
        alpha_blend(img, overlay, alpha)
        rounded_rect(img, (x, y), (x + w, y + h), theme.panel2, radius=radius, thickness=1)

    def _pill(self, img: np.ndarray, x: int, y: int, w: int, h: int, fill: Color, text: str, text_color: Optional[Color] = None, scale: float = 0.34) -> None:
        rounded_rect(img, (x, y), (x + w, y + h), fill, radius=h // 2, thickness=-1)
        tw, th = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)[0]
        draw_text(img, text, x + max(8, (w - tw) // 2), y + (h + th) // 2 - 2, scale, text_color or self.theme.text, 1)

    def _progress(self, img: np.ndarray, x: int, y: int, w: int, value: float, color: Color) -> None:
        value = clamp(value, 0.0, 1.0)
        rounded_rect(img, (x, y), (x + w, y + 7), self.theme.panel2, radius=4, thickness=-1)
        if value > 0.01:
            rounded_rect(img, (x, y), (x + max(8, int(w * value)), y + 7), color, radius=4, thickness=-1)

    def _draw_header(self, img: np.ndarray) -> None:
        theme = self.theme
        h, w = img.shape[:2]
        self._soft_card(img, 24, 20, 330, 66, alpha=0.90, radius=25)
        draw_text(img, "Harmoni", 45, 54, 0.70, theme.text, 2)
        draw_text(img, "canli vokal ve piyano esligi", 46, 75, 0.31, theme.muted, 1)

        self._soft_card(img, w - 354, 20, 330, 66, alpha=0.90, radius=25)
        with self.state.lock:
            audio_status = self.state.audio_status
            latency = self.state.latency_ms
            camera_fps = self.state.camera_fps
            detector_fps = self.state.detector_fps
        online = "ONLINE" in audio_status
        dot_color = theme.success if online else theme.warning
        cv2.circle(img, (w - 328, 52), 6, dot_color, -1, cv2.LINE_AA)
        status_text = "Dinliyor ve eslik ediyor" if online else "Ses sistemi beklemede"
        draw_text(img, status_text, w - 312, 56, 0.37, theme.text, 1)
        fps = float(np.mean(self.fps_history)) if self.fps_history else 0.0
        draw_text(img, f"ekran {fps:0.0f}  kamera {camera_fps:0.0f}  el {detector_fps:0.0f}  | {latency:0.0f} ms", w - 312, 76, 0.24, theme.muted, 1)

    def _draw_vocal_card(self, img: np.ndarray) -> None:
        theme = self.theme
        x, y, w, h = 24, 112, 252, 344
        self._soft_card(img, x, y, w, h, alpha=0.88)
        with self.state.lock:
            pitch = PitchSnapshot(**vars(self.state.pitch))
            music = MusicSnapshot(**vars(self.state.music))
            vocal_level = self.state.vocal_level

        draw_text(img, "Sesin", x + 20, y + 32, 0.45, theme.text, 1)
        draw_text(img, "Su an duydugum nota", x + 20, y + 55, 0.31, theme.muted, 1)
        note_text = pitch.note_name if pitch.voiced else "—"
        draw_text(img, note_text, x + 18, y + 120, 1.42, theme.primary, 2)
        draw_text(img, f"{pitch.frequency:0.1f} Hz", x + 142, y + 103, 0.39, theme.text, 1)
        draw_text(img, f"{pitch.cents:+0.1f} cent", x + 142, y + 126, 0.30, theme.muted, 1)

        draw_text(img, "Nota netligi", x + 20, y + 164, 0.31, theme.muted, 1)
        draw_text(img, f"%{int(pitch.confidence * 100)}", x + 192, y + 164, 0.31, theme.text, 1)
        self._progress(img, x + 20, y + 176, w - 40, pitch.confidence, theme.primary)

        level = clamp(vocal_level * 11.0, 0.0, 1.0)
        draw_text(img, "Ses seviyesi", x + 20, y + 211, 0.31, theme.muted, 1)
        draw_text(img, f"%{int(level * 100)}", x + 192, y + 211, 0.31, theme.text, 1)
        self._progress(img, x + 20, y + 223, w - 40, level, theme.secondary)

        draw_text(img, "Tonalite", x + 20, y + 266, 0.31, theme.muted, 1)
        draw_text(img, music.key_name.title(), x + 20, y + 296, 0.54, theme.text, 1)

        fx = self.audio.dsp
        self._pill(img, x + 20, y + 314, 91, 25, theme.panel2, "Dogal", theme.text, 0.30)
        reverb_label = f"Reverb %{int(clamp(fx.reverb_mix / 0.24, 0, 1) * 100)}"
        self._pill(img, x + 119, y + 314, 112, 25, theme.secondary, reverb_label, theme.text, 0.27)

    def _draw_music_card(self, img: np.ndarray) -> None:
        theme = self.theme
        h, w = img.shape[:2]
        x, y, cw, ch = w // 2 - 145, 112, 290, 108
        self._soft_card(img, x, y, cw, ch, alpha=0.91, radius=28)
        with self.state.lock:
            music = MusicSnapshot(**vars(self.state.music))
            pitch = PitchSnapshot(**vars(self.state.pitch))

        # Soft beat indicator.
        center = (x + 51, y + 54)
        cv2.circle(img, center, 29, theme.panel2, -1, cv2.LINE_AA)
        cv2.ellipse(img, center, (29, 29), 0, -90, int(-90 + music.beat_phase * 360), theme.primary, 4, cv2.LINE_AA)
        cv2.circle(img, center, 6, theme.primary, -1, cv2.LINE_AA)

        draw_text(img, "Su anki eslik", x + 92, y + 30, 0.31, theme.muted, 1)
        draw_text(img, music.chord_name, x + 91, y + 70, 0.92, theme.text, 2)
        listening = pitch.note_name if pitch.voiced else "dinliyor"
        draw_text(img, f"{music.bpm:0.0f} BPM  |  {listening}", x + 92, y + 94, 0.31, theme.muted, 1)

    def _draw_orchestra_card(self, img: np.ndarray) -> None:
        theme = self.theme
        h_img, w_img = img.shape[:2]
        x, y, w, h = w_img - 276, 112, 252, 402
        self._soft_card(img, x, y, w, h, alpha=0.88)
        with self.state.lock:
            layers = set(self.state.active_layers)
            gesture = self.state.gesture
            detail = self.state.gesture_detail

        draw_text(img, "Eslik", x + 20, y + 34, 0.45, theme.text, 1)
        draw_text(img, "El hareketlerinle degisir", x + 20, y + 57, 0.31, theme.muted, 1)

        layer_rows = [
            ("PIANO", "Piyano"),
            ("STRINGS", "Yaylilar"),
            ("PAD", "Yumusak pad"),
            ("BASS", "Bas"),
            ("DRUMS", "Ritim"),
        ]
        yy = y + 89
        for key, label in layer_rows:
            active = key in layers
            fill = tuple(int(theme.panel[i] * 0.68 + theme.primary[i] * 0.32) for i in range(3)) if active else theme.panel2
            dot = theme.success if active else theme.muted
            rounded_rect(img, (x + 18, yy), (x + w - 18, yy + 43), fill, radius=15, thickness=-1)
            cv2.circle(img, (x + 38, yy + 21), 5, dot, -1, cv2.LINE_AA)
            draw_text(img, label, x + 53, yy + 27, 0.37, theme.text, 1)
            draw_text(img, "acik" if active else "kapali", x + 171, yy + 27, 0.28, theme.text if active else theme.muted, 1)
            yy += 51

        draw_text(img, "Algilanan hareket", x + 20, y + 352, 0.29, theme.muted, 1)
        readable_gesture = gesture.replace("OPEN_HAND", "ACIK EL").replace("RIGHT", "SAG").replace("LEFT", "SOL")
        draw_text(img, readable_gesture[:25], x + 20, y + 377, 0.36, theme.text, 1)
        draw_text(img, detail[:30].title(), x + 20, y + 397, 0.27, theme.muted, 1)

    def _draw_bottom_deck(self, img: np.ndarray) -> None:
        theme = self.theme
        h, w = img.shape[:2]
        x, y, bw, bh = 300, h - 184, w - 600, 160
        self._soft_card(img, x, y, bw, bh, alpha=0.90, radius=27)
        draw_text(img, "Canli akis", x + 20, y + 28, 0.34, theme.text, 1)
        draw_text(img, "Q cikis | E efekt | V monitoring | 9/0 piyano sesi | 1-4 tema", x + 128, y + 28, 0.25, theme.muted, 1)
        self._draw_waveform(img, x + 20, y + 42, bw - 40, 42)
        self._draw_keyboard(img, x + 20, y + 91, bw - 40, 49)

    def _draw_hand_skeletons(self, img: np.ndarray, hands: Sequence[HandPacket]) -> None:
        theme = self.theme
        overlay = img.copy()
        for hand in hands:
            color = theme.primary if hand.label == "RIGHT" else theme.secondary
            for a, b in HAND_CONNECTIONS:
                cv2.line(overlay, hand.landmarks[a], hand.landmarks[b], color, 2, cv2.LINE_AA)
            for idx in (THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP):
                cv2.circle(overlay, hand.landmarks[idx], 4, color, -1, cv2.LINE_AA)
            cx, cy = hand.palm_center
            label = "Sag el" if hand.label == "RIGHT" else "Sol el"
            label += " | " + hand.gesture.replace("OPEN_HAND", "Acik").replace("FIST", "Kapali").replace("PEACE", "Peace").title()
            tw = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.29, 1)[0][0]
            rounded_rect(overlay, (cx - tw // 2 - 10, cy + 37), (cx + tw // 2 + 10, cy + 62), theme.panel, radius=13, thickness=-1)
            draw_text(overlay, label, cx - tw // 2, cy + 54, 0.29, theme.text, 1)
            if hand.gesture == "PINCH":
                p1, p2 = hand.landmarks[THUMB_TIP], hand.landmarks[INDEX_TIP]
                cv2.line(overlay, p1, p2, theme.accent, 3, cv2.LINE_AA)
        alpha_blend(img, overlay, 0.72)

        if len(hands) >= 2 and all(hand.gesture == "OPEN_HAND" for hand in hands[:2]):
            p1, p2 = hands[0].palm_center, hands[1].palm_center
            bridge = img.copy()
            cv2.line(bridge, p1, p2, theme.accent, 2, cv2.LINE_AA)
            alpha_blend(img, bridge, 0.30)

    def _draw_waveform(self, img: np.ndarray, x: int, y: int, w: int, h: int) -> None:
        theme = self.theme
        with self.state.lock:
            waveform = np.asarray(self.state.waveform, dtype=np.float32).copy()
        if waveform.size < 2:
            return
        xs = np.linspace(x, x + w, waveform.size).astype(np.int32)
        center_y = y + h // 2
        ys = (center_y - np.clip(waveform, -0.6, 0.6) * (h * 0.75)).astype(np.int32)
        points = np.column_stack((xs, ys)).reshape(-1, 1, 2)
        fill_points = np.vstack([
            points.reshape(-1, 2),
            np.array([[x + w, center_y], [x, center_y]], dtype=np.int32),
        ]).reshape(-1, 1, 2)
        fill = img.copy()
        cv2.fillPoly(fill, [fill_points], theme.secondary, cv2.LINE_AA)
        alpha_blend(img, fill, 0.18)
        cv2.polylines(img, [points], False, theme.primary, 2, cv2.LINE_AA)

    def _draw_keyboard(self, img: np.ndarray, x: int, y: int, width: int, height: int) -> None:
        theme = self.theme
        with self.state.lock:
            chord_notes = set(n % 12 for n in self.state.music.chord_notes)
            pitch_note = self.state.pitch.midi_note % 12 if self.state.pitch.voiced else -1
        white_count = 14
        key_w = width / white_count
        white_pcs = [0, 2, 4, 5, 7, 9, 11]
        for i in range(white_count):
            pc = white_pcs[i % 7]
            x1 = int(x + i * key_w)
            x2 = int(x + (i + 1) * key_w - 2)
            active = pc in chord_notes
            color = theme.primary if active else theme.panel
            rounded_rect(img, (x1, y), (x2, y + height), color, radius=5, thickness=-1)
            rounded_rect(img, (x1, y), (x2, y + height), theme.panel2, radius=5, thickness=1)
            if pc == pitch_note:
                rounded_rect(img, (x1 + 3, y + 3), (x2 - 3, y + height - 3), theme.accent, radius=4, thickness=2)
        black_positions = [0, 1, 3, 4, 5]
        black_pcs = [1, 3, 6, 8, 10]
        for octave in range(2):
            base = octave * 7
            for pos, pc in zip(black_positions, black_pcs):
                bx = int(x + (base + pos + 0.70) * key_w)
                key_width = max(8, int(key_w * 0.55))
                active = pc in chord_notes
                color = theme.secondary if active else (83, 79, 86)
                rounded_rect(img, (bx, y), (bx + key_width, y + int(height * 0.61)), color, radius=4, thickness=-1)
                if pc == pitch_note:
                    rounded_rect(img, (bx + 2, y + 2), (bx + key_width - 2, y + int(height * 0.61) - 2), theme.accent, radius=3, thickness=2)


# -----------------------------------------------------------------------------
# ANA UYGULAMA
# -----------------------------------------------------------------------------

class HarmoniApp:
    def __init__(self, camera_index: int = CAMERA_INDEX, demo: bool = False, performance: str = "balanced", piano_volume: float = 0.27) -> None:
        self.camera_index = camera_index
        self.demo = demo
        self.performance = performance
        self.state = RuntimeState()
        self.audio = AudioEngine(self.state)
        self.audio.synth.music_gain = clamp(piano_volume, 0.08, 0.46)
        process_every = {"fast": 3, "balanced": 2, "quality": 1}.get(performance, 2)
        process_width = {"fast": 384, "balanced": 512, "quality": 640}.get(performance, 512)
        self.hand_tracker = HandTracker(process_width=process_width, process_every=process_every)
        self.gesture_controller = GestureController(self.state, self.audio)
        self.renderer = HUDRenderer(self.state, self.audio)
        self.camera: Optional[CameraWorker] = None
        self.running = True
        self.mirror = True
        self.recording = False
        self.writer: Optional[cv2.VideoWriter] = None
        self.toast = ""
        self.toast_until = 0.0
        self.demo_phase = 0.0
        self.last_frame: Optional[np.ndarray] = None
        self.last_camera_frame_id = -1
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    def init_camera(self) -> bool:
        if self.demo:
            return False
        width, height = {
            "fast": (640, 360),
            "balanced": (CAM_CAPTURE_WIDTH, CAM_CAPTURE_HEIGHT),
            "quality": (CAM_WIDTH, CAM_HEIGHT),
        }.get(self.performance, (CAM_CAPTURE_WIDTH, CAM_CAPTURE_HEIGHT))
        self.camera = CameraWorker(self.camera_index, width, height, CAM_FPS, self.state)
        self.camera.start()
        self.camera.opened.wait(timeout=2.0)
        return self.camera.cap is not None

    def set_toast(self, message: str, duration: float = 1.8) -> None:
        self.toast = message
        self.toast_until = time.time() + duration

    def _fallback_frame(self) -> np.ndarray:
        h, w = CAM_HEIGHT, CAM_WIDTH
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        theme = self.renderer.theme
        frame[:] = theme.bg
        self.demo_phase += 0.035
        draw_text(frame, "Kamera bekleniyor", 520, 348, 0.66, theme.text, 1)
        draw_text(frame, "Kamera indeksini kontrol et veya baska uygulamadaki kamerayi kapat", 386, 384, 0.34, theme.muted, 1)
        return frame

    def _read_frame(self) -> np.ndarray:
        frame = None
        frame_id = self.last_camera_frame_id
        if self.camera is not None:
            frame, frame_id = self.camera.get_latest(self.last_camera_frame_id)
        if frame is not None:
            self.last_camera_frame_id = frame_id
            if frame.shape[1] != CAM_WIDTH or frame.shape[0] != CAM_HEIGHT:
                frame = cv2.resize(frame, (CAM_WIDTH, CAM_HEIGHT), interpolation=cv2.INTER_LINEAR)
            if self.mirror:
                frame = cv2.flip(frame, 1)
            self.last_frame = frame
            return frame
        if self.last_frame is not None:
            return self.last_frame.copy()
        return self._fallback_frame()

    def _draw_toast(self, img: np.ndarray) -> None:
        if time.time() >= self.toast_until or not self.toast:
            return
        theme = self.renderer.theme
        h, w = img.shape[:2]
        box_w = min(620, max(280, 22 + len(self.toast) * 10))
        x1, y1 = (w - box_w) // 2, h - 118
        overlay = img.copy()
        rounded_rect(overlay, (x1, y1), (x1 + box_w, y1 + 42), theme.panel, radius=15, thickness=-1)
        alpha_blend(img, overlay, 0.90)
        rounded_rect(img, (x1, y1), (x1 + box_w, y1 + 42), theme.primary, radius=15, thickness=1)
        draw_text(img, self.toast, x1 + 18, y1 + 27, 0.36, theme.text, 1)

    def _save_screenshot(self, frame: np.ndarray) -> None:
        stamp = time.strftime("%Y%m%d_%H%M%S")
        path = OUTPUT_DIR / f"harmoni_{stamp}.png"
        cv2.imwrite(str(path), frame)
        self.set_toast(f"Goruntu kaydedildi: {path.name}")

    def _toggle_recording(self, frame: np.ndarray) -> None:
        if self.recording:
            self.recording = False
            if self.writer is not None:
                self.writer.release()
            self.writer = None
            self.set_toast("Kayit tamamlandi")
            return
        h, w = frame.shape[:2]
        stamp = time.strftime("%Y%m%d_%H%M%S")
        path = OUTPUT_DIR / f"harmoni_{stamp}.mp4"
        self.writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (w, h))
        if not self.writer.isOpened():
            self.writer = None
            self.set_toast("Video kaydi acilamadi")
            return
        self.recording = True
        self.set_toast(f"Kayit: {path.name}")

    def handle_key(self, key: int, frame: np.ndarray) -> None:
        if key in (ord("q"), ord("Q"), 27):
            self.running = False
        elif key in (ord("h"), ord("H")):
            self.renderer.hud_enabled = not self.renderer.hud_enabled
        elif key in (ord("e"), ord("E")):
            self.audio.dsp.enabled = not self.audio.dsp.enabled
            self.set_toast(f"Vokal efektleri {'acik' if self.audio.dsp.enabled else 'kapali'}")
        elif key in (ord("v"), ord("V")):
            self.audio.dsp.monitor_enabled = not self.audio.dsp.monitor_enabled
            self.set_toast(f"Vokal monitoring {'acik' if self.audio.dsp.monitor_enabled else 'kapali'}")
        elif key in (ord("m"), ord("M")):
            self.mirror = not self.mirror
        elif key in (ord("f"), ord("F")):
            self.audio.synth.full_orchestra()
            self.set_toast("Tum katmanlar acildi")
        elif key in (ord("x"), ord("X")):
            self.audio.synth.mute_extras()
            self.set_toast("Yalnizca piyano")
        elif key == 32:
            bpm = self.audio.harmony.tap_tempo()
            self.set_toast(f"Tempo {bpm:0.1f} BPM", 0.8)
        elif key == ord("["):
            self.audio.harmony.adjust_bpm(-2.0)
        elif key == ord("]"):
            self.audio.harmony.adjust_bpm(2.0)
        elif key in (ord("-"), ord("_")):
            self.audio.dsp.reverb_mix = clamp(self.audio.dsp.reverb_mix - 0.015, 0.0, 0.30)
        elif key in (ord("+"), ord("=")):
            self.audio.dsp.reverb_mix = clamp(self.audio.dsp.reverb_mix + 0.015, 0.0, 0.30)
        elif key == ord("9"):
            value = self.audio.synth.adjust_music_gain(-0.025)
            self.set_toast(f"Piyano sesi %{int(value / 0.46 * 100)}", 0.8)
        elif key == ord("0"):
            value = self.audio.synth.adjust_music_gain(0.025)
            self.set_toast(f"Piyano sesi %{int(value / 0.46 * 100)}", 0.8)
        elif key in (ord("s"), ord("S")):
            self._save_screenshot(frame)
        elif key in (ord("r"), ord("R")):
            self._toggle_recording(frame)
        elif ord("1") <= key <= ord("4"):
            self.renderer.cycle_theme(key - ord("1"))

    def run(self) -> None:
        camera_ok = self.init_camera()
        audio_ok = self.audio.start()
        if not camera_ok:
            self.set_toast("Kamera acilamadi; demo goruntusu kullaniliyor", 3.0)
        if not audio_ok:
            self.set_toast("Ses aygiti acilamadi", 3.0)

        window_name = "HARMONI"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, CAM_WIDTH, CAM_HEIGHT)
        try:
            while self.running:
                frame_started = time.perf_counter()
                frame = self._read_frame()
                hands = self.hand_tracker.process(frame)
                with self.state.lock:
                    self.state.detector_fps = self.hand_tracker.detector_fps
                self.gesture_controller.update(hands)
                self.audio.update_harmony()
                final = self.renderer.render(frame, hands)
                if self.recording and self.writer is not None:
                    cv2.circle(final, (CAM_WIDTH - 34, 98), 7, self.renderer.theme.danger, -1, cv2.LINE_AA)
                    draw_text(final, "REC", CAM_WIDTH - 83, 104, 0.34, self.renderer.theme.danger, 2)
                    self.writer.write(final)
                self._draw_toast(final)
                cv2.imshow(window_name, final)
                self.handle_key(cv2.waitKey(1) & 0xFF, final)
                elapsed = time.perf_counter() - frame_started
                self.renderer.update_fps(1.0 / max(elapsed, 1e-6))
        finally:
            self.cleanup()

    def cleanup(self) -> None:
        if self.writer is not None:
            self.writer.release()
            self.writer = None
        if self.camera is not None:
            self.camera.stop()
            self.camera = None
        self.audio.stop()
        self.hand_tracker.close()
        cv2.destroyAllWindows()


# -----------------------------------------------------------------------------
# SELF TEST VE ONIZLEME
# -----------------------------------------------------------------------------


def create_preview(path: Path) -> None:
    state = RuntimeState()
    audio = AudioEngine(state)
    renderer = HUDRenderer(state, audio)
    with state.lock:
        state.audio_status = "SELF TEST ONLINE"
        state.pitch = PitchSnapshot(
            frequency=220.0,
            midi_note=57,
            note_name="LA3",
            confidence=0.91,
            rms=0.062,
            cents=1.7,
            voiced=True,
            timestamp=time.time(),
        )
        state.music = MusicSnapshot(
            key_name="G# MINOR",
            key_root=8,
            mode="minor",
            chord_name="G#m",
            chord_notes=(44, 47, 51),
            bpm=88.0,
            beat_phase=0.42,
            key_confidence=0.87,
        )
        state.vocal_level = 0.062
        state.output_level = 0.11
        state.latency_ms = 21.4
        state.gesture = "RIGHT OPEN_HAND"
        state.gesture_detail = "STRINGS KATMANI ACIK"
        state.active_layers = {"PIANO", "STRINGS", "PAD"}
        x = np.linspace(0, 8 * math.pi, 256)
        state.waveform = (0.24 * np.sin(x) * np.hanning(256)).astype(np.float32)

    h, w = CAM_HEIGHT, CAM_WIDTH
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]
    # Warm studio-like backdrop for the preview.
    frame[:, :, 0] = np.clip(226 + (yy / h) * 18, 0, 255)
    frame[:, :, 1] = np.clip(231 + (xx / w) * 12, 0, 255)
    frame[:, :, 2] = np.clip(239 + ((w - xx) / w) * 10, 0, 255)
    room = frame.copy()
    cv2.circle(room, (w // 2, int(h * 0.47)), 230, (220, 226, 238), -1, cv2.LINE_AA)
    cv2.rectangle(room, (350, 300), (930, 650), (217, 224, 233), -1, cv2.LINE_AA)
    cv2.ellipse(room, (640, 715), (510, 120), 0, 180, 360, (205, 218, 211), -1, cv2.LINE_AA)
    room = cv2.GaussianBlur(room, (0, 0), 42)
    frame = cv2.addWeighted(frame, 0.48, room, 0.52, 0)


    def fake_hand(cx: int, cy: int, label: str, color_shift: float) -> HandPacket:
        pts = []
        for idx in range(21):
            angle = (idx / 21.0) * math.tau
            radius = 36 + (idx % 5) * 7
            pts.append((int(cx + math.cos(angle) * radius), int(cy + math.sin(angle) * radius - (idx % 4) * 4)))
        # Landmark geometrisini elle daha okunur hâle getir.
        pts[WRIST] = (cx, cy + 58)
        pts[INDEX_MCP] = (cx - 22, cy + 12)
        pts[MIDDLE_MCP] = (cx, cy + 3)
        pts[RING_MCP] = (cx + 20, cy + 12)
        pts[PINKY_MCP] = (cx + 36, cy + 25)
        pts[THUMB_TIP] = (cx - 62, cy + 5)
        pts[INDEX_TIP] = (cx - 35, cy - 74)
        pts[MIDDLE_TIP] = (cx - 4, cy - 90)
        pts[RING_TIP] = (cx + 27, cy - 75)
        pts[PINKY_TIP] = (cx + 53, cy - 52)
        return HandPacket(
            label=label,
            landmarks=pts,
            normalized=[(0.0, 0.0, 0.0)] * 21,
            gesture="OPEN_HAND",
            confidence=0.96,
            openness=0.9,
            pinch=0.6,
            fingers=(True, True, True, True, True),
            palm_center=(cx, cy),
            hand_size=130.0,
        )

    hands = [fake_hand(505, 390, "LEFT", 0.0), fake_hand(775, 390, "RIGHT", 1.0)]
    for _ in range(40):
        renderer.update_fps(30.0)
    final = renderer.render(frame, hands)
    cv2.imwrite(str(path), final)


def run_self_test() -> int:
    print("[1/7] Pitch detector test")
    state = RuntimeState()
    tracker = PitchTracker(state)
    t = np.arange(4096, dtype=np.float64) / AUDIO_SR
    sine = (0.16 * np.sin(2.0 * math.pi * 220.0 * t)).astype(np.float32)
    pitch = tracker.detect(sine)
    if not pitch.voiced or abs(pitch.frequency - 220.0) > 6.0:
        raise RuntimeError(f"Pitch test failed: {pitch}")

    print("[2/7] Vocal DSP test")
    dsp = VocalDSP()
    processed = dsp.process(sine[:AUDIO_BLOCK])
    if processed.shape != (AUDIO_BLOCK, 2) or not np.isfinite(processed).all():
        raise RuntimeError("Vocal DSP produced invalid output")

    print("[3/7] Harmony engine test")
    harmony = HarmonyEngine(state)
    for note in (57, 60, 64, 57, 60, 64, 67):
        harmony.update(PitchSnapshot(
            frequency=midi_to_frequency(note),
            midi_note=note,
            note_name=midi_to_name(note, True),
            confidence=0.9,
            rms=0.07,
            voiced=True,
            timestamp=time.time() + note * 0.0001,
        ))
        harmony.last_chord_change = 0.0
    with state.lock:
        if not state.music.chord_notes:
            raise RuntimeError("Harmony engine produced no chord")

    print("[4/7] Synth render test")
    synth = SynthEngine(state)
    synth.full_orchestra()
    rendered = synth.render(AUDIO_BLOCK)
    if rendered.shape != (AUDIO_BLOCK, 2) or not np.isfinite(rendered).all():
        raise RuntimeError("Synth produced invalid output")

    print("[5/7] Vocal ducking test")
    duck_state = RuntimeState()
    with duck_state.lock:
        duck_state.music.chord_notes = (45, 48, 52)
        duck_state.music.phrase_active = True
        duck_state.vocal_level = 0.05
    duck_synth = SynthEngine(duck_state)
    active_mix = duck_synth.render(AUDIO_BLOCK)
    if not np.isfinite(active_mix).all() or duck_synth.music_gain > 0.46:
        raise RuntimeError("Ducking test failed")

    print("[6/7] Renderer performance test")
    bench_state = RuntimeState()
    bench_audio = AudioEngine(bench_state)
    bench_renderer = HUDRenderer(bench_state, bench_audio)
    bench_frame = np.full((CAM_HEIGHT, CAM_WIDTH, 3), 210, dtype=np.uint8)
    started = time.perf_counter()
    for _ in range(12):
        bench_renderer.render(bench_frame, [])
    render_fps = 12.0 / max(time.perf_counter() - started, 1e-6)
    print(f"    Renderer benchmark: {render_fps:0.1f} fps")
    if render_fps < 10.0:
        raise RuntimeError(f"Renderer too slow: {render_fps:0.1f} fps")

    print("[7/7] HUD preview")
    preview = Path(__file__).with_name("harmoni_preview.png")
    create_preview(preview)
    print(f"Self test passed. Preview: {preview}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HARMONI")
    parser.add_argument("--camera", type=int, default=CAMERA_INDEX, help="OpenCV camera index")
    parser.add_argument("--demo", action="store_true", help="Kamera olmadan gorsel demo arka plani")
    parser.add_argument("--self-test", action="store_true", help="Donanim acmadan cekirdek testleri calistir")
    parser.add_argument("--performance", choices=("fast", "balanced", "quality"), default="balanced", help="Kamera/el takip performans profili")
    parser.add_argument("--piano-volume", type=float, default=0.27, help="Piyano ana seviyesi, 0.08-0.46")
    parser.add_argument("--no-monitor", action="store_true", help="Canli vokal monitoring kapali baslat")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        return run_self_test()

    if not MP_AVAILABLE:
        print("[UYARI] MediaPipe yuklenemedi. El takibi devre disi.")
        print("Kurulum: python -m pip install mediapipe")
    if not SOUNDDEVICE_AVAILABLE:
        print("[UYARI] sounddevice yuklenemedi. Mikrofon ve ses cikisi devre disi.")
        print("Kurulum: python -m pip install sounddevice")

    app = HarmoniApp(camera_index=args.camera, demo=args.demo, performance=args.performance, piano_volume=args.piano_volume)
    if args.no_monitor:
        app.audio.dsp.monitor_enabled = False
    try:
        app.run()
    except KeyboardInterrupt:
        app.cleanup()
    except Exception as exc:
        app.cleanup()
        print(f"[HATA] {exc}")
        print("Kontrol listesi:")
        print("1) Kamera baska uygulama tarafindan kullaniliyor mu?")
        print("2) --camera 1 gibi farkli kamera indeksi denendi mi?")
        print("3) Kulaklik ve varsayilan giris/cikis aygiti secili mi?")
        print("4) requirements.txt paketleri kurulu mu?")
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
