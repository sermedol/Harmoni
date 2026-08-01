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
import json
import math
import os
import queue
import random
import sys
import threading
import time
import wave
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

try:
    from scipy.signal import lfilter
    SCIPY_AVAILABLE = True
except Exception:  # pragma: no cover - opsiyonel bagimlilik
    lfilter = None
    SCIPY_AVAILABLE = False

try:
    import mido
    MIDO_AVAILABLE = True
except Exception:  # pragma: no cover - opsiyonel bagimlilik
    mido = None
    MIDO_AVAILABLE = False

try:
    import fluidsynth as _fluidsynth_module  # pyfluidsynth
    FLUIDSYNTH_AVAILABLE = True
except Exception:  # pragma: no cover - opsiyonel bagimlilik
    _fluidsynth_module = None
    FLUIDSYNTH_AVAILABLE = False


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

# Kameradan istenecek yakalama cozunurlugu (--resolution). HUD/arayuz her
# zaman CAM_WIDTH x CAM_HEIGHT (1280x720) uzerinde bilesimlenir (bu, ~20
# cizim metodunda test edilmis sabit bir tasarim cozunurlugudur); daha
# yuksek bir yakalama cozunurlugu istemek, el takibi ve nihai 720p goruntu
# icin daha fazla kaynak detayindan (supersampling) faydalanir, ancak nihai
# pencere/kayit boyutunu buyutmez. Pencerenin kendisini native 4K yapmak,
# tum HUD koordinatlarinin olcekli yeniden yazilmasini gerektiren ayri ve
# daha buyuk bir is olur (bkz. README - Kamera cozunurlugu).
RESOLUTION_PRESETS: Dict[str, Tuple[int, int]] = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "4k": (3840, 2160),
}

AUDIO_SR = 48_000
AUDIO_BLOCK = 256
AUDIO_CHANNELS_IN = 1
AUDIO_CHANNELS_OUT = 2

OUTPUT_DIR = Path("harmoni_captures")
# PyInstaller ile derlenmis (frozen) halde __file__ her calistirmada gecici bir
# cikartma dizinini gosterir; ayarlarin kalici olmasi icin bu durumda
# sys.executable'in bulundugu klasor kullanilir.
if getattr(sys, "frozen", False):
    _APP_DIR = Path(sys.executable).resolve().parent
else:
    _APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = _APP_DIR / "harmoni_config.json"
DEFAULT_CONFIG: Dict[str, object] = {
    "theme_index": 0,
    "piano_volume": 0.30,
    "performance": "balanced",
    "camera_index": 0,
    "monitor_enabled": True,
    "mirror": True,
    "resolution": "",
    "simple_mode": True,
}


def load_config(path: Optional[Path] = None) -> Dict[str, object]:
    """Onceki oturumdan kalan ayarlari okur. Dosya yoksa veya bozuksa
    sessizce varsayilanlara duser; hicbir zaman hata firlatmaz."""
    target = path or CONFIG_PATH
    config = dict(DEFAULT_CONFIG)
    try:
        if target.is_file():
            with target.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                for key in DEFAULT_CONFIG:
                    if key in data:
                        config[key] = data[key]
    except Exception:
        pass
    return config


def save_config(config: Dict[str, object], path: Optional[Path] = None) -> None:
    """Ayarlari bir sonraki oturum icin kaydeder. Yazma basarisiz olursa
    (ornegin salt-okunur dizin) sessizce yok sayilir."""
    target = path or CONFIG_PATH
    try:
        payload = {key: config.get(key, DEFAULT_CONFIG[key]) for key in DEFAULT_CONFIG}
        with target.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except Exception:
        pass

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
# TURK MAKAM SISTEMI (AEU 53 KOMA)
# -----------------------------------------------------------------------------
#
# Kaynak: Arel-Ezgi-Uzdilek (AEU) kuramindaki 53 komali oktav bolumlemesi.
# Sayisal aralik tablolari, Sonic Pi projesinin (sonic-pi-net/sonic-pi, MIT
# lisansli) GitHub uzerindeki #1705 numarali "Microtonal scales, makams"
# pull request'inde (kivancguckiran tarafindan) tanimlanan dortlu/besli
# (tetrachord/pentachord) yapi taslarindan alinmistir. Her deger, bir
# sonraki perdeye kadar olan koma sayisidir (1 koma = 1200/53 ~= 22.64 cent);
# yedi aralik toplami tam oktav icin her zaman 53 koma eder.
#
# NOT: Bir makam, yalnizca bir perde kumesi (dizi) degildir; "seyir" (melodik
# ilerleyis), "guclu" (baskin perde) ve "asma karar" gibi performans kurallari
# da makamin kimligini belirler. Bu tablo yalnizca dizi/perde boyutunu temsil
# eder; ornegin Neva ve Huseyni ayni ham perde kumesini paylasabilir ama
# gelenekte seyirleriyle ayrisirlar. Saba makami, kendine has (oktava tam
# oturmayan) yapisi nedeniyle bu basit dizi modeline uygun olmadigindan
# kasitli olarak disarida birakilmistir.
KOMA_CENTS = 1200.0 / 53.0

MAKAM_SCALES_KOMA: Dict[str, Tuple[int, ...]] = {
    "CARGAH": (9, 9, 4, 9, 9, 9, 4),
    "BUSELIK": (9, 4, 9, 9, 9, 4, 9),
    "KURDI": (4, 9, 9, 9, 4, 9, 9),
    "RAST": (9, 8, 5, 9, 9, 8, 5),
    "HICAZ": (5, 12, 5, 9, 8, 5, 9),
    "USSAK": (8, 5, 9, 9, 4, 9, 9),
    "NIHAVENT": (9, 4, 9, 9, 4, 9, 9),
    "HUZZAM": (5, 9, 5, 12, 5, 12, 5),
    "KARCIGAR": (8, 5, 9, 5, 12, 5, 9),
    "SEGAH": (5, 9, 8, 9, 5, 12, 5),
    "NEVA": (8, 5, 9, 9, 8, 5, 9),
    "HUSEYNI": (8, 5, 9, 9, 8, 5, 9),
}

MAKAM_DISPLAY_NAMES: Dict[str, str] = {
    # NOT: OpenCV'nin yerleşik Hershey fontu (cv2.putText) Türkçe'ye özgü
    # ç/ğ/ı/ö/ş/ü ve inceltmeli harfleri düzgün çizemez; bu yüzden ekran
    # (HUD) metinleri kasıtlı olarak ASCII'dir. Doğru yazımlar (Çargâh,
    # Hüzzam, Uşşak, Karcığar, Segâh, Nevâ, Hüseynî, Kürdî) README'de yer alır.
    "CARGAH": "Cargah", "BUSELIK": "Buselik", "KURDI": "Kurdi", "RAST": "Rast",
    "HICAZ": "Hicaz", "USSAK": "Ussak", "NIHAVENT": "Nihavent", "HUZZAM": "Huzzam",
    "KARCIGAR": "Karcigar", "SEGAH": "Segah", "NEVA": "Neva", "HUSEYNI": "Huseyni",
}


def komas_to_semitones(komas: float) -> float:
    return komas * 12.0 / 53.0


def frequency_to_koma(frequency: float) -> float:
    """Frekansi 53 komali surekli bir konuma cevirir (12-TET midi degeriyle ayni olcekte)."""
    return frequency_to_midi(frequency) * 53.0 / 12.0


# Klasik perde adlari, Rast'a gore koma cinsinden konum. Rast=0 referans
# alinarak rast/hicaz yapi taslarindan (yukaridaki MAKAM_SCALES_KOMA ile ayni
# kaynak) turetilmistir: Dugah=+9 (Rast dortlusunun ilk adimi), Segah=+17,
# Cargah=+22, Neva=+31, Huseyni=+40, Evic=+48, Gerdaniye=+53 (Rast'in oktavi).
# Kaynak (isim<->Bati perdesi karsiligi): turkishudlessons.com/sufi.gen.tr
# makam nazariyati ozetleri (Rast=Sol, Dugah=La, Cargah=Do, Neva=Re, ...).
PERDE_NAMES_KOMA: Tuple[Tuple[int, str], ...] = (
    (-22, "Yegah"),
    (0, "Rast"),
    (9, "Dugah"),
    (17, "Segah"),
    (22, "Cargah"),
    (31, "Neva"),
    (40, "Huseyni"),
    (48, "Evic"),
    (53, "Gerdaniye"),
    (62, "Muhayyer"),
    (75, "Tiz Cargah"),
)
# Rast perdesinin geleneksel/pedagojik yaklasik referansi: G3. Gercek icrada
# topluluga, bolgeye ve enstrumana gore kesin referans frekans degisir; bu
# yalnizca egitim amacli goreli bir isimlendirme sunar, mutlak bir standart
# degildir (bkz. README).
PERDE_REFERENCE_MIDI = 55.0


def nearest_perde_name(frequency: float) -> Tuple[str, float]:
    """Bir frekansa en yakin klasik perde adini ve o perdeden sapmayi
    (cent cinsinden, +sarp/-bemol) dondurur."""
    reference_koma = PERDE_REFERENCE_MIDI * 53.0 / 12.0
    koma_position = frequency_to_koma(frequency) - reference_koma
    best_name = "Rast"
    best_diff = 1e18
    for koma, name in PERDE_NAMES_KOMA:
        for octave_k in range(-3, 4):
            diff = koma_position - (koma + 53 * octave_k)
            if abs(diff) < abs(best_diff):
                best_diff = diff
                best_name = name
    return best_name, best_diff * KOMA_CENTS


def makam_scale_degrees_komas(name: str) -> Tuple[int, ...]:
    """Tonikten (durak) itibaren 7 perdenin koma cinsinden konumu (0..52)."""
    intervals = MAKAM_SCALES_KOMA[name]
    offsets = [0]
    total = 0
    for step in intervals[:-1]:
        total += step
        offsets.append(total)
    return tuple(offsets)


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
    dark: bool = False


# Profesyonel stüdyo yazılımlarından (dark-mode DAW arayüzleri) ilham alan
# temalar. Renkler RGB olarak tasarlanip OpenCV'nin BGR sırasına çevrilmiştir.
# "dark" bayrağı, kamera görüntüsü tonlamasını ve parlaklık/glow
# yoğunluğunu temaya göre ayarlamak için kullanılır.
THEMES: List[Theme] = [
    Theme(
        "MIDNIGHT",
        (24, 18, 16), (40, 31, 28), (78, 64, 58),
        (240, 233, 230), (192, 180, 175),
        (248, 189, 56), (250, 139, 167), (21, 204, 250),
        (113, 113, 248), (128, 222, 74), (60, 146, 251),
        dark=True,
    ),
    Theme(
        "STUDIO",
        (17, 18, 20), (27, 29, 32), (52, 58, 64),
        (225, 235, 240), (170, 180, 190),
        (11, 158, 245), (66, 113, 251), (191, 212, 45),
        (68, 68, 239), (53, 230, 163), (21, 204, 250),
        dark=True,
    ),
    Theme(
        "ANADOLU",
        (15, 17, 24), (23, 27, 38), (46, 56, 74),
        (220, 232, 245), (158, 172, 196),
        (63, 122, 224), (153, 166, 45), (74, 181, 232),
        (65, 69, 214), (88, 189, 140), (74, 159, 230),
        dark=True,
    ),
    Theme(
        "DAYLIGHT",
        (248, 246, 245), (255, 255, 255), (234, 229, 226),
        (40, 33, 30), (128, 116, 110),
        (229, 70, 79), (233, 165, 14), (6, 119, 217),
        (38, 38, 220), (74, 163, 22), (4, 138, 202),
        dark=False,
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


def one_pole_lowpass(x: np.ndarray, coeff: float, state: float) -> Tuple[np.ndarray, float]:
    """y[n] = (1-coeff)*x[n] + coeff*y[n-1].

    Gercek-zamanli ses callback'inde guvenlik icin scipy.signal.lfilter
    kullanir; scipy yoksa fonksiyonel olarak ozdes ama daha yavas bir saf
    Python dongusune duser.
    """
    x64 = np.asarray(x, dtype=np.float64)
    if SCIPY_AVAILABLE:
        y, _ = lfilter([1.0 - coeff], [1.0, -coeff], x64, zi=[coeff * state])
        return y, float(y[-1])
    y = np.empty_like(x64)
    acc = state
    for i in range(len(x64)):
        acc = (1.0 - coeff) * float(x64[i]) + coeff * acc
        y[i] = acc
    return y, acc


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
    tonal_system: str = "western"  # "western" | "makam"
    makam_name: str = "HICAZ"
    makam_tonic_koma: int = 38  # durak (tonik) perde sinifi, 0..52 koma
    makam_confidence: float = 0.0
    makam_degrees: Tuple[float, ...] = ()
    rhythm_feel: str = "duz"  # "duz" | "aksak" - kaba bir sezgisel, gercek usul tespiti degil


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
    auto_arrange_enabled: bool = True
    show_guide: bool = False
    simple_mode: bool = True
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

# Batı fonksiyonel armonisinde 7 dizi derecesinin (0=I) kısa etiketleri; egitim
# amacli HUD gosterimi icindir, ses motorunu etkilemez.
WESTERN_DEGREE_LABELS = ("Tonik", "II", "III", "Subdominant", "Dominant", "VI", "VII")


class HarmonyEngine:
    """Söylenen melodiyi izleyip kararlı, yumuşak bir eşlik üretir.

    Tonalite değişimleri birkaç saniye doğrulanır. Akorlar yalnızca müzikal
    vuruş sınırlarında değişir; anlık pitch hataları eşliği zıplatmaz.
    """

    def __init__(self, state: RuntimeState) -> None:
        self.state = state
        self.note_weights = np.zeros(12, dtype=np.float64)
        self.koma_weights = np.zeros(53, dtype=np.float64)
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
        self.makam_candidate: Optional[Tuple[str, int]] = None
        self.makam_candidate_since = 0.0
        self.previous_makam_degree: Optional[int] = None
        self.tap_times: Deque[float] = deque(maxlen=8)
        self.started = time.monotonic()
        self.mode_override: Optional[str] = None

    def toggle_tonal_system(self) -> str:
        with self.state.lock:
            new_system = "makam" if self.state.music.tonal_system == "western" else "western"
            self.state.music.tonal_system = new_system
        return new_system

    def cycle_mode_color(self) -> str:
        """Batı sisteminde otomatik majör/minör tespitinin ötesinde, kullanıcının
        elle Dorian/Mixolydian rengine gecmesini saglar (folk/rock/caz gibi
        modal muzikler icin). Bu bir otomatik tespit DEGILDIR - kullanicinin
        bilincli sectigi bir renktir; 'auto'ya donunce otomatik tespit
        kaldigi yerden devam eder."""
        order = ["auto", "major", "minor", "dorian", "mixolydian"]
        current = self.mode_override if self.mode_override in order else "auto"
        next_choice = order[(order.index(current) + 1) % len(order)]
        self.mode_override = None if next_choice == "auto" else next_choice
        if self.mode_override is not None:
            with self.state.lock:
                root = self.state.music.key_root
                self.state.music.mode = self.mode_override
                self.state.music.key_name = f"{NOTE_NAMES[root]} {self.mode_override.upper()}"
        return next_choice

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
        self.koma_weights *= math.exp(-elapsed / 10.0)

        if pitch.voiced and pitch.confidence > 0.30 and pitch.timestamp != self.last_pitch_timestamp:
            self.last_pitch_timestamp = pitch.timestamp
            weight = clamp(pitch.confidence, 0.25, 1.0) * clamp(pitch.rms * 18.0, 0.12, 1.0)
            self.note_weights[pitch.midi_note % 12] += weight
            koma_bin = int(round(frequency_to_koma(pitch.frequency))) % 53
            self.koma_weights[koma_bin] += weight
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
        with self.state.lock:
            tonal_system = self.state.music.tonal_system
        if now - self.last_key_update > 0.55:
            if tonal_system == "makam":
                self._estimate_makam(now)
            else:
                self._estimate_key(now)
            self._estimate_tempo()
            self._estimate_rhythm_feel()
            self.last_key_update = now

        with self.state.lock:
            bpm = self.state.music.bpm
            self.state.music.beat_phase = ((now - self.started) * bpm / 60.0) % 1.0
            self.state.music.phrase_active = phrase_active
            self.state.music.vocal_center_midi = vocal_center

        # Akor/derece değişimi iki vuruşta bir değerlendirilir. Melodi mevcut
        # akora/dereceye oturuyorsa dört vuruşa kadar korunur.
        beat_seconds = 60.0 / max(bpm, 1.0)
        minimum_interval = beat_seconds * 2.0
        if tonal_system == "makam":
            current_fits = self._current_makam_fits(pitch)
        else:
            current_fits = self._current_chord_fits(pitch)
        desired_interval = beat_seconds * (4.0 if current_fits else 2.0)
        if now - self.last_chord_change >= max(minimum_interval, desired_interval):
            if tonal_system == "makam":
                self._choose_makam_degree(pitch)
            else:
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

    def _estimate_rhythm_feel(self) -> None:
        """Nota baslangic araliklarinin degiskenligine bakarak kaba bir
        'aksak' (duzensiz, orn. 7/8-9/8 gibi Anadolu ritimleri) / 'duz'
        (duzenli) ayrimi yapar. Bu gercek bir usul/meter tespiti degildir;
        yalnizca AutoArranger'in enstrumantasyon secimine yon vermesi icin
        kullanilan bir sezgiseldir (bkz. README)."""
        if len(self.onset_times) < 7:
            return
        intervals = np.diff(np.asarray(self.onset_times, dtype=np.float64))
        intervals = intervals[(intervals >= 0.15) & (intervals <= 1.6)]
        if intervals.size < 6:
            return
        median = float(np.median(intervals))
        if median <= 1e-6:
            return
        normalized = intervals / median
        variability = float(np.std(normalized))
        feel = "aksak" if variability > 0.32 else "duz"
        with self.state.lock:
            self.state.music.rhythm_feel = feel

    def _estimate_key(self, now: float) -> None:
        if self.mode_override is not None:
            # Kullanici 'D' ile bir dizi rengini (dorian/mixolydian) kilitlemis;
            # otomatik tespit devre disi kalir, tonik sabit tutulur.
            return
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

    # Perde onemine gore agirlik: durak (0. derece) ve guclu (4. derece, "5.")
    # gelenekte bir makamin en yapisal iki perdesidir; bu, Krumhansl-Schmuckler
    # profillerindeki tonik/dominant agirliklandirmasiyla ayni ilkeye dayanir.
    # Bu agirliklandirma olmadan, ayni koma coklugunu paylasan mod-benzeri
    # makamlar (orn. Cargah/Kurdi/Buselik/Nihavent) birbirinden ayrilamaz.
    _MAKAM_DEGREE_WEIGHTS = (3.0, 1.0, 1.3, 1.5, 2.2, 1.0, 1.4)

    def _estimate_makam(self, now: float) -> None:
        """53 komali koma-chroma'yi her makamin 7 perdelik agirlikli profiliyle
        karsilastirir (12 makam x 53 olasi durak = 636 aday). Ampirik olcum
        verisi (SymbTr gibi) yerine durak/guclu agirlikli teorik bir
        yaklasimdir; bu bilincli bir basitlestirmedir (bkz. README)."""
        total = float(np.sum(self.koma_weights))
        if total < 0.65:
            return
        chroma53 = self.koma_weights / max(total, 1e-9)
        best_score = -1e9
        second_score = -1e9
        best: Optional[Tuple[str, int]] = None
        for name in MAKAM_SCALES_KOMA:
            offsets = makam_scale_degrees_komas(name)
            profile = np.zeros(53, dtype=np.float64)
            for idx, offset in enumerate(offsets):
                profile[offset] = self._MAKAM_DEGREE_WEIGHTS[idx]
            for tonic in range(53):
                score = float(np.dot(chroma53, np.roll(profile, tonic)))
                if score > best_score:
                    second_score = best_score
                    best_score = score
                    best = (name, tonic)
                elif score > second_score:
                    second_score = score
        if best is None:
            return
        name, tonic = best
        confidence = clamp((best_score - second_score + 0.05) / 0.20, 0.0, 1.0)
        candidate = (name, tonic)
        with self.state.lock:
            current = (self.state.music.makam_name, self.state.music.makam_tonic_koma)
        if candidate != current:
            if self.makam_candidate != candidate:
                self.makam_candidate = candidate
                self.makam_candidate_since = now
                return
            if confidence < 0.22 or now - self.makam_candidate_since < 2.2:
                return
        with self.state.lock:
            self.state.music.makam_name = name
            self.state.music.makam_tonic_koma = tonic
            self.state.music.makam_confidence = confidence
            self.state.music.key_name = f"{MAKAM_DISPLAY_NAMES.get(name, name.title())} Makami"

    def _current_makam_fits(self, pitch: PitchSnapshot) -> bool:
        if not pitch.voiced:
            return True
        with self.state.lock:
            tonic = self.state.music.makam_tonic_koma
            name = self.state.music.makam_name
        offsets = {(tonic + o) % 53 for o in makam_scale_degrees_komas(name)}
        koma_bin = int(round(frequency_to_koma(pitch.frequency))) % 53
        return koma_bin in offsets or (koma_bin - 1) % 53 in offsets or (koma_bin + 1) % 53 in offsets

    def _choose_makam_degree(self, pitch: PitchSnapshot) -> None:
        with self.state.lock:
            name = self.state.music.makam_name
            tonic_koma = self.state.music.makam_tonic_koma
            vocal_center = self.state.music.vocal_center_midi
        offsets = makam_scale_degrees_komas(name)
        tonic_pc = komas_to_semitones(tonic_koma)
        # Toniği vokal merkezinin bir-bir buçuk oktav altına yerleştir; böylece
        # dron ve eşlik perdeleri her zaman vokalin altında kalır.
        base_tonic = tonic_pc
        while base_tonic > vocal_center - 6.0:
            base_tonic -= 12.0
        while base_tonic < vocal_center - 24.0:
            base_tonic += 12.0
        degree_pitches = tuple(base_tonic + komas_to_semitones(o) for o in offsets)

        melody_koma = int(round(frequency_to_koma(pitch.frequency))) % 53 if pitch.voiced else tonic_koma
        # En yakin perdeyi (0. derece = durak) melodiye gore sec; guclu (5. derece,
        # index 4) ve durak (index 0) hafifçe kayirilir (gelenekte bu perdeler
        # eşliğin agirlik merkezidir).
        best_degree = 0
        best_distance = 1e9
        for idx, offset in enumerate(offsets):
            koma_pos = (tonic_koma + offset) % 53
            distance = min((koma_pos - melody_koma) % 53, (melody_koma - koma_pos) % 53)
            bias = -3.0 if idx in (0, 4) else 0.0
            score = distance + bias
            if score < best_distance:
                best_distance = score
                best_degree = idx

        changed = best_degree != self.previous_makam_degree
        self.previous_makam_degree = best_degree
        tonic_perde, _ = nearest_perde_name(midi_to_frequency(base_tonic))
        with self.state.lock:
            self.state.music.makam_degrees = degree_pitches
            self.state.music.chord_notes = tuple(int(round(p)) for p in (degree_pitches[0], degree_pitches[4], degree_pitches[0] + 12.0))
            self.state.music.chord_name = f"{MAKAM_DISPLAY_NAMES.get(name, name.title())} - {tonic_perde} ({midi_to_name(int(round(base_tonic)), turkish=True)})"
            self.state.music.accompaniment_confidence = clamp(1.0 - best_distance / 26.5, 0.0, 1.0)
            if changed:
                self.state.music.chord_revision += 1

    @staticmethod
    def _scale_intervals(mode: str) -> Sequence[int]:
        return {
            "major": (0, 2, 4, 5, 7, 9, 11),
            "minor": (0, 2, 3, 5, 7, 8, 10),
            "dorian": (0, 2, 3, 5, 7, 9, 10),
            "mixolydian": (0, 2, 4, 5, 7, 9, 10),
        }.get(mode, (0, 2, 3, 5, 7, 8, 10))

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
        label = WESTERN_DEGREE_LABELS[degree % len(WESTERN_DEGREE_LABELS)]
        with self.state.lock:
            self.state.music.chord_name = f"{name} - {label}"
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
        # Vokalin daha "guzel"/stüdyo kaydi gibi duyulmasi icin varsayilan
        # netlik/sicaklik ve hafif reverb+eco biraz yukseltildi (pinch jesti
        # hala 0.05-0.24 / 0.01-0.095 araliginda ustune kontrol saglar).
        self.clarity = 0.19
        self.warmth = 0.17
        self.reverb_mix = 0.16
        self.echo_mix = 0.055
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

        # Yaklasik 80 Hz high-pass. Tek kutuplu LP cikarimi, vektorize.
        cutoff = 80.0
        alpha = math.exp(-2.0 * math.pi * cutoff / self.sample_rate)
        low, self.low_state = one_pole_lowpass(x, alpha, self.low_state)
        hp = x.astype(np.float64) - low

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

        # Geri beslemeyi hafif low-pass ile yumusat (vektorize).
        feedback_l = 0.36 * wet_l + 0.09 * echo_l
        feedback_r = 0.36 * wet_r + 0.09 * echo_r
        smooth_l, self.feedback_lpf_l = one_pole_lowpass(feedback_l, 0.77, self.feedback_lpf_l)
        smooth_r, self.feedback_lpf_r = one_pole_lowpass(feedback_r, 0.77, self.feedback_lpf_r)

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
    midi_note: float
    kind: str
    velocity: float
    duration_samples: int
    pan: float = 0.0
    phase: float = 0.0
    age_samples: int = 0
    seed: int = 0
    ks_buffer: Optional[np.ndarray] = None  # Karplus-Strong (baglama) gecikme hatti
    ks_pos: int = 0


class FluidSynthBackend:
    """Opsiyonel gercek soundfont (.sf2) render motoru.

    yalnizca `pyfluidsynth` kurulu VE gecerli bir soundfont dosyasi
    `--soundfont` ile verildiginde etkinlesir. Herhangi bir asamada
    basarisiz olursa `self.available = False` kalir ve cagiran taraf
    (SynthEngine) sessizce procedural sentezlemeye devam eder.
    """

    PROGRAMS: Dict[str, Tuple[int, int]] = {
        "piano": (0, 0),
        "piano_soft": (0, 0),
        "strings": (1, 48),
        "pad": (2, 89),
        "bass": (3, 33),
        "baglama": (4, 104),  # GM Sitar; bağlamanın telli/perdeli karakterine en yakın GM sesi
        "flute": (5, 73),     # GM Flute
        "brass": (6, 61),     # GM Brass Section
        "ney": (7, 75),       # GM Pan Flute; ney'e en yakın nefesli GM sesi
        "guitar": (8, 25),    # GM Acoustic Guitar (steel)
        "keman": (10, 40),    # GM Violin (kanal 9 davul icin ayrilmis, atlaniyor)
    }
    DRUM_CHANNEL = 9
    DRUM_NOTES: Dict[str, int] = {"kick": 36, "snare": 38, "hat": 42}

    def __init__(self, soundfont_path: str, sample_rate: int = AUDIO_SR) -> None:
        self.available = False
        self.error = ""
        self.synth = None
        if not FLUIDSYNTH_AVAILABLE:
            self.error = "pyfluidsynth kurulu degil (pip install pyfluidsynth)"
            return
        if not Path(soundfont_path).is_file():
            self.error = f"Soundfont dosyasi bulunamadi: {soundfont_path}"
            return
        try:
            self.synth = _fluidsynth_module.Synth(samplerate=float(sample_rate))
            sfid = self.synth.sfload(soundfont_path)
            if sfid == -1:
                raise RuntimeError("Soundfont yuklenemedi (sfload -1 dondu)")
            for channel, program in self.PROGRAMS.values():
                self.synth.program_select(channel, sfid, 0, program)
            self.synth.program_select(self.DRUM_CHANNEL, sfid, 128, 0)
            self.available = True
        except Exception as exc:  # pragma: no cover - native kutuphane bagimliligi
            self.error = str(exc)
            self.synth = None
            self.available = False

    def note_on(self, kind: str, midi_note: int, velocity: float) -> None:
        if not self.available or self.synth is None:
            return
        vel = int(clamp(velocity, 0.0, 1.0) * 127)
        if vel <= 0:
            return
        note = int(clamp(midi_note, 0, 127))
        try:
            if kind in self.DRUM_NOTES:
                self.synth.noteon(self.DRUM_CHANNEL, self.DRUM_NOTES[kind], vel)
            elif kind == "davul":
                # Procedural synth'te "davul" dusuk/yuksek notaya gore dum/tek
                # sesi secer; GM davul kanalinda da ayni nota degeri kullanilir
                # (yaklasik esdeger: 40~Electric Snare, 64~Low Conga).
                self.synth.noteon(self.DRUM_CHANNEL, note, vel)
            else:
                channel, _ = self.PROGRAMS.get(kind, (0, 0))
                self.synth.noteon(channel, note, vel)
        except Exception:  # pragma: no cover - native kutuphane bagimliligi
            pass

    def note_off(self, kind: str, midi_note: int) -> None:
        if not self.available or self.synth is None:
            return
        note = int(clamp(midi_note, 0, 127))
        try:
            if kind in self.DRUM_NOTES:
                self.synth.noteoff(self.DRUM_CHANNEL, self.DRUM_NOTES[kind])
            elif kind == "davul":
                self.synth.noteoff(self.DRUM_CHANNEL, note)
            else:
                channel, _ = self.PROGRAMS.get(kind, (0, 0))
                self.synth.noteoff(channel, note)
        except Exception:  # pragma: no cover - native kutuphane bagimliligi
            pass

    def render(self, frames: int) -> np.ndarray:
        if not self.available or self.synth is None:
            return np.zeros((frames, 2), dtype=np.float32)
        try:
            raw = np.asarray(self.synth.get_samples(frames), dtype=np.float32) / 32768.0
            stereo = raw.reshape(-1, 2)
        except Exception:  # pragma: no cover - native kutuphane bagimliligi
            return np.zeros((frames, 2), dtype=np.float32)
        return np.clip(stereo, -1.0, 1.0).astype(np.float32)

    def close(self) -> None:
        if self.synth is not None:
            try:
                self.synth.delete()
            except Exception:
                pass
            self.synth = None


class SynthEngine:
    """Vokalin altında kalan, side-chain ducking kullanan hafif eşlik synth'i."""

    def __init__(self, state: RuntimeState, sample_rate: int = AUDIO_SR) -> None:
        self.state = state
        self.sample_rate = sample_rate
        self.voices: List[Voice] = []
        self.voice_lock = threading.RLock()
        self.step_index = 0
        self.samples_to_step = 0.0
        self.music_gain = 0.30
        self.density = 0.38
        self.duck_gain = 0.62
        self.last_chord_revision = -1
        self.max_voices = 44
        self.brightness = 1.0  # 0..1, jestle kontrol edilir (el aciklik derecesi)
        self._bright_state_l = 0.0
        self._bright_state_r = 0.0
        self.articulation = 0.5  # 0..1, jestle kontrol edilir (staccato..legato)
        self.fluid: Optional[FluidSynthBackend] = None
        self.pending_note_offs: List[Tuple[int, str, int]] = []
        self.midi_recording = False
        self.midi_events: List[Tuple[float, str, int, float, float]] = []
        self.midi_record_start = 0.0

        # Orkestra icin hafif, paylasilan bir "oda" reverb'i: vokal ve eslik
        # ayni akustik alanda gibi hissettirir, sentetik/kuru bir katman
        # olmaktan cikarir. VocalDSP'nin reverb yaklasimiyla ayni (vektorize,
        # gercek-zamanli guvenli) mimariyi kullanir.
        self.reverb_mix = 0.15
        self.reverb_size = int(sample_rate * 0.55)
        self.reverb_l = np.zeros(self.reverb_size, dtype=np.float32)
        self.reverb_r = np.zeros(self.reverb_size, dtype=np.float32)
        self.reverb_pos = 0
        self.reverb_taps = [int(sample_rate * t) for t in (0.029, 0.061, 0.097, 0.14)]
        self.reverb_fb_l = 0.0
        self.reverb_fb_r = 0.0

    def attach_fluidsynth(self, backend: "FluidSynthBackend") -> None:
        self.fluid = backend

    def start_midi_capture(self) -> None:
        with self.voice_lock:
            self.midi_events = []
            self.midi_record_start = time.monotonic()
            self.midi_recording = True

    def stop_midi_capture(self) -> List[Tuple[float, str, int, float, float]]:
        with self.voice_lock:
            self.midi_recording = False
            events = self.midi_events
            self.midi_events = []
        return events

    def set_layers(self, layers: Iterable[str]) -> None:
        # Piyano artik otomatik olarak zorlanmiyor - kullanici P tusuyla onu da
        # kapatabilir (bkz. handle_key). Tum katmanlar bosalirsa tam sessizlik
        # yerine piyanoya geri donulur (guvenlik agi).
        with self.state.lock:
            resolved = set(layers)
            self.state.active_layers = resolved if resolved else {"PIANO"}

    def toggle_layer(self, layer: str) -> bool:
        with self.state.lock:
            layers = set(self.state.active_layers)
            if layer in layers:
                layers.remove(layer)
                active = False
            else:
                layers.add(layer)
                active = True
            self.state.active_layers = layers if layers else {"PIANO"}
        return active

    def mute_extras(self) -> None:
        self.set_layers({"PIANO"})

    def full_orchestra(self) -> None:
        self.set_layers({
            "PIANO", "STRINGS", "BASS", "DRUMS", "PAD", "BAGLAMA", "WOODWINDS", "BRASS", "NEY",
            "GITAR", "KEMAN", "DAVUL",
        })

    def adjust_music_gain(self, delta: float) -> float:
        self.music_gain = clamp(self.music_gain + delta, 0.08, 0.46)
        return self.music_gain

    def set_brightness(self, value: float) -> None:
        """0 = bogucu/karanlik, 1 = tam parlak. El aciklik derecesiyle surekli kontrol edilir."""
        self.brightness = clamp(value, 0.0, 1.0)

    def set_articulation(self, value: float) -> None:
        """0 = staccato (kisa, ayrik notalar), 1 = legato (uzun, bagli notalar).
        El hareket hiziyla surekli kontrol edilir."""
        self.articulation = clamp(value, 0.0, 1.0)

    def trigger(self, midi_note: float, kind: str, velocity: float = 0.7, duration: float = 0.8, pan: float = 0.0) -> None:
        if velocity <= 0.001:
            return
        duration_samples = max(64, int(duration * self.sample_rate))
        if self.midi_recording:
            onset = time.monotonic() - self.midi_record_start
            with self.voice_lock:
                self.midi_events.append((onset, kind, int(round(midi_note)), clamp(velocity, 0.0, 1.0), float(duration)))
        if self.fluid is not None and self.fluid.available:
            # FluidSynth/GM standardi 12-TET'tir; mikrotonal perdeler en yakin
            # yari-sese yuvarlanir (bkz. README - bilinen kisit).
            self.fluid.note_on(kind, int(round(midi_note)), velocity)
            with self.voice_lock:
                self.pending_note_offs.append((duration_samples, kind, int(round(midi_note))))
            return
        voice = Voice(
            midi_note=float(midi_note), kind=kind,
            velocity=clamp(velocity, 0.0, 1.0),
            duration_samples=duration_samples,
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
        step = self.step_index % 8
        beat_seconds = 60.0 / max(music.bpm, 1.0)
        phrase_active = music.phrase_active
        chord_changed = music.chord_revision != self.last_chord_revision
        if chord_changed:
            self.last_chord_revision = music.chord_revision
        # Artikülasyon (jestle kontrol edilir) nota süresini staccato<->legato arasında uzatir/kisaltir.
        articulation_scale = lerp(0.55, 1.4, self.articulation)

        if music.tonal_system == "makam":
            self._schedule_makam_step(music, layers, step, beat_seconds, phrase_active, chord_changed, articulation_scale)
        else:
            self._schedule_western_step(music, layers, step, beat_seconds, phrase_active, chord_changed, articulation_scale)
        self.step_index += 1

    def _schedule_makam_step(
        self, music: MusicSnapshot, layers: Set[str], step: int, beat_seconds: float,
        phrase_active: bool, chord_changed: bool, articulation_scale: float,
    ) -> None:
        """Bati'daki blok akor yerine dron (durak+guclu) + bagimsiz melodik
        cevap figuru: gercek makam icrasindaki heterofonik/dron dokusuna
        (bkz. README - Kaynaklar) sadik kalmak icin kasitli olarak farklidir."""
        degrees = music.makam_degrees
        if not degrees:
            return
        tonic = degrees[0]
        guclu = degrees[4] if len(degrees) > 4 else degrees[-1]

        if chord_changed and step in (0, 4):
            self.trigger(tonic - 12.0, "pad", 0.13 if phrase_active else 0.19, beat_seconds * 7.4, pan=-0.35)
            self.trigger(guclu - 12.0, "pad", 0.10 if phrase_active else 0.14, beat_seconds * 7.4, pan=0.35)
            if "BASS" in layers:
                self.trigger(tonic - 24.0, "bass", 0.28 if phrase_active else 0.36, beat_seconds * 3.6, pan=-0.05)
            if "STRINGS" in layers:
                for note in (tonic, guclu):
                    self.trigger(note, "strings", 0.11, beat_seconds * 3.6, pan=0.0)

        active_steps = (0, 3, 5) if phrase_active else (0, 1, 3, 4, 5, 6)
        if step in active_steps:
            pattern = (0, 2, 1, 4, 3, 2, 1, 0)
            note = degrees[pattern[step] % len(degrees)]
            velocity = 0.29 if phrase_active else 0.38
            self.trigger(note, "baglama", velocity, beat_seconds * 1.1 * articulation_scale, pan=-0.1 + 0.2 * (step / 7.0))

        if "NEY" in layers and step in (2, 6) and not phrase_active:
            note = degrees[(4 if step == 2 else 2) % len(degrees)]
            self.trigger(note, "ney", 0.23, beat_seconds * 3.4, pan=-0.15)

        if "WOODWINDS" in layers and chord_changed and step in (0, 4):
            self.trigger(degrees[-1], "flute", 0.12 if phrase_active else 0.18, beat_seconds * 3.0, pan=0.3)

        if "KEMAN" in layers and step in (1, 5) and not phrase_active:
            note = degrees[(3 if step == 1 else 1) % len(degrees)]
            self.trigger(note, "keman", 0.18, beat_seconds * 2.6, pan=0.3)

        if "GITAR" in layers and step in (1, 3, 5, 7):
            pattern = (1, 3, 2, 0)
            note = degrees[pattern[(step // 2) % len(pattern)] % len(degrees)]
            velocity = 0.17 if phrase_active else 0.24
            self.trigger(note, "guitar", velocity, beat_seconds * 0.9 * articulation_scale, pan=-0.2)

        if "DAVUL" in layers:
            if step in (0, 4):
                self.trigger(40.0, "davul", 0.17 if phrase_active else 0.24, 0.35, pan=-0.1)
            elif step in (2, 6):
                self.trigger(64.0, "davul", 0.13 if phrase_active else 0.19, 0.12, pan=0.1)

        if "BRASS" in layers and step in (0, 4) and not phrase_active:
            self.trigger(tonic, "brass", 0.15, beat_seconds * 1.0, pan=0.0)
            self.trigger(guclu, "brass", 0.13, beat_seconds * 1.0, pan=0.2)

        if "DRUMS" in layers:
            self.trigger(36, "kick", 0.22 if step in (0, 4) else 0.0, 0.18)
            if step in (2, 6):
                self.trigger(38, "snare", 0.15, 0.17)

    def _schedule_western_step(
        self, music: MusicSnapshot, layers: Set[str], step: int, beat_seconds: float,
        phrase_active: bool, chord_changed: bool, articulation_scale: float,
    ) -> None:
        chord = list(music.chord_notes)
        if not chord:
            return
        # Şarkı söylenirken seyrek ve düşük seviyeli; nefes boşluklarında biraz daha dolu.
        if "PIANO" in layers:
            active_steps = (0, 2, 4, 6) if phrase_active else (0, 1, 2, 4, 5, 6)
            if step in active_steps:
                pattern = (0, 1, 2, 1, 0, 2, 1, 2)
                note = chord[pattern[step] % len(chord)]
                velocity = 0.30 if phrase_active else 0.38
                self.trigger(note, "piano", velocity, beat_seconds * 0.68 * articulation_scale, pan=-0.08 + 0.16 * (step / 7.0))
            if chord_changed and step in (0, 4):
                for idx, n in enumerate(chord):
                    self.trigger(n, "piano_soft", 0.15 if phrase_active else 0.21, beat_seconds * 1.45 * articulation_scale, pan=(-0.18 + idx * 0.18))

        if "BASS" in layers and step in (0, 4):
            self.trigger(chord[0] - 12, "bass", 0.30 if phrase_active else 0.38, beat_seconds * 0.90 * articulation_scale, pan=-0.06)

        if "STRINGS" in layers and chord_changed and step in (0, 4):
            for idx, note in enumerate(chord):
                self.trigger(note, "strings", 0.13, beat_seconds * 3.6, pan=(-0.45 + idx * 0.45))

        if "PAD" in layers and chord_changed and step in (0, 4):
            for idx, note in enumerate(chord):
                self.trigger(note - 12, "pad", 0.095, beat_seconds * 3.8, pan=(-0.58 + idx * 0.58))

        if "WOODWINDS" in layers and chord_changed and step in (2, 6):
            self.trigger(chord[-1] + 12, "flute", 0.14 if phrase_active else 0.21, beat_seconds * 3.2, pan=0.25)

        if "BRASS" in layers and step in (0, 4) and not phrase_active:
            for idx, note in enumerate(chord):
                self.trigger(note, "brass", 0.17, beat_seconds * 1.1, pan=(-0.3 + idx * 0.3))

        if "BAGLAMA" in layers and step in (1, 3, 5, 7):
            pattern = (2, 0, 1, 0)
            note = chord[pattern[(step // 2) % len(pattern)] % len(chord)]
            velocity = 0.19 if phrase_active else 0.26
            self.trigger(note, "baglama", velocity, beat_seconds * 0.8 * articulation_scale, pan=0.15)

        if "GITAR" in layers and step in (1, 3, 5, 7):
            pattern = (1, 2, 0, 1)
            note = chord[pattern[(step // 2) % len(pattern)] % len(chord)]
            velocity = 0.17 if phrase_active else 0.23
            self.trigger(note, "guitar", velocity, beat_seconds * 0.7 * articulation_scale, pan=-0.2)

        if "KEMAN" in layers and chord_changed and step in (2, 6) and not phrase_active:
            self.trigger(chord[-1] + 12, "keman", 0.17, beat_seconds * 3.0, pan=0.35)

        if "DAVUL" in layers:
            if step in (0, 4):
                self.trigger(40.0, "davul", 0.18 if phrase_active else 0.26, 0.35, pan=-0.1)
            elif step in (2, 6):
                self.trigger(64.0, "davul", 0.14 if phrase_active else 0.20, 0.12, pan=0.1)

        if "DRUMS" in layers:
            self.trigger(36, "kick", 0.24 if step in (0, 4) else 0.0, 0.18)
            if step in (2, 6):
                self.trigger(38, "snare", 0.18, 0.17)
            if step % 2 == 0:
                self.trigger(42, "hat", 0.07, 0.08, pan=0.18)

    def render(self, frames: int) -> np.ndarray:
        with self.state.lock:
            bpm = self.state.music.bpm
            vocal_level = self.state.vocal_level
            phrase_active = self.state.music.phrase_active
            layer_count = len(self.state.active_layers)
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

            if self.fluid is not None and self.fluid.available and self.pending_note_offs:
                remaining_offs: List[Tuple[int, str, int]] = []
                for remaining, kind, note in self.pending_note_offs:
                    remaining -= frames
                    if remaining <= 0:
                        self.fluid.note_off(kind, note)
                    else:
                        remaining_offs.append((remaining, kind, note))
                self.pending_note_offs = remaining_offs

        if self.fluid is not None and self.fluid.available:
            output = output + self.fluid.render(frames)

        # Vokal aktifken eslik hafifce geri cekilir ama duyulmaya devam eder
        # ("arkada senfoni" hissi); nefes bosluklarinda tam seviyeye doner.
        target_duck = 0.62 if (phrase_active or vocal_level > 0.009) else 0.74
        self.duck_gain += (target_duck - self.duck_gain) * 0.12
        # Katman sayisi arttikca (orn. tam orkestra 9 katman) toplam enerji
        # aritmetik olarak degil sqrt oranla telafi edilir; boylece daha fazla
        # enstruman acmak sesi vokalin ustune yigmaz. Referans: eski "tam
        # orkestra" boyutu (5 katman) - bu deger asilmadikca kazanc degismez.
        gain_compensation = clamp(math.sqrt(5.0 / max(layer_count, 1)), 0.6, 1.0)
        output *= self.music_gain * self.duck_gain * gain_compensation
        output = np.clip(output, -0.72, 0.72)

        # El aciklik derecesiyle kontrol edilen parlaklik filtresi (tek kutuplu low-pass).
        if self.brightness < 0.995:
            cutoff = lerp(600.0, 17000.0, clamp(self.brightness, 0.0, 1.0) ** 0.55)
            coeff = math.exp(-2.0 * math.pi * cutoff / self.sample_rate)
            left, self._bright_state_l = one_pole_lowpass(output[:, 0], coeff, self._bright_state_l)
            right, self._bright_state_r = one_pole_lowpass(output[:, 1], coeff, self._bright_state_r)
            output = np.column_stack((left, right))
        output = self._apply_orchestra_reverb(output)
        return np.clip(output, -0.72, 0.72).astype(np.float32)

    def _apply_orchestra_reverb(self, stereo: np.ndarray) -> np.ndarray:
        """Orkestra veriyoluna hafif, paylasilan bir oda reverb'i uygular
        (VocalDSP.process ile ayni vektorize/gercek-zamanli-guvenli desen)."""
        frames = stereo.shape[0]
        if frames == 0 or self.reverb_mix <= 0.001:
            return stereo
        idx = (np.arange(frames, dtype=np.int64) + self.reverb_pos) % self.reverb_size
        wet_l = np.zeros(frames, dtype=np.float64)
        wet_r = np.zeros(frames, dtype=np.float64)
        for tap, gain in zip(self.reverb_taps, (0.42, 0.30, 0.20, 0.13)):
            wet_l += self.reverb_l[(idx - tap) % self.reverb_size] * gain
            wet_r += self.reverb_r[(idx - tap) % self.reverb_size] * gain
        feedback_l = 0.30 * wet_l
        feedback_r = 0.30 * wet_r
        smooth_l, self.reverb_fb_l = one_pole_lowpass(feedback_l, 0.6, self.reverb_fb_l)
        smooth_r, self.reverb_fb_r = one_pole_lowpass(feedback_r, 0.6, self.reverb_fb_r)
        dry_l = stereo[:, 0].astype(np.float64)
        dry_r = stereo[:, 1].astype(np.float64)
        self.reverb_l[idx] = np.clip(dry_l + smooth_r, -1.2, 1.2)
        self.reverb_r[idx] = np.clip(dry_r + smooth_l, -1.2, 1.2)
        self.reverb_pos = int((self.reverb_pos + frames) % self.reverb_size)
        out_l = dry_l + wet_l * self.reverb_mix
        out_r = dry_r + wet_r * self.reverb_mix
        return np.column_stack((out_l, out_r))

    def _karplus_strong_pluck(
        self, voice: Voice, frames: int, frequency: float, decay_low: float, decay_high: float, burst_tone: float = 0.5,
    ) -> np.ndarray:
        """Tek bir dairesel gecikme hatti (delay line) uzerinde klasik
        Karplus-Strong yinelemesi; bağlama ve gitar sesleri bunu paylaşır."""
        if voice.ks_buffer is None:
            n_delay = max(4, int(round(self.sample_rate / max(frequency, 20.0))))
            rng = np.random.default_rng(voice.seed)
            burst = rng.uniform(-1.0, 1.0, size=n_delay).astype(np.float64)
            burst = burst_tone * burst + (1.0 - burst_tone) * np.concatenate(([0.0], burst[:-1]))
            voice.ks_buffer = burst
            voice.ks_pos = 0
        buffer = voice.ks_buffer
        n_delay = len(buffer)
        decay = decay_low if voice.midi_note < 60 else decay_high
        out = np.empty(frames, dtype=np.float64)
        pos = voice.ks_pos
        for i in range(frames):
            current = buffer[pos]
            nxt = buffer[(pos + 1) % n_delay]
            out[i] = current
            buffer[pos] = decay * 0.5 * (current + nxt)
            pos = (pos + 1) % n_delay
        voice.ks_pos = pos
        return out

    def _render_voice(self, voice: Voice, frames: int) -> np.ndarray:
        n = np.arange(frames, dtype=np.float64) + voice.age_samples
        t = n / self.sample_rate
        frequency = midi_to_frequency(voice.midi_note)
        phase = voice.phase + 2.0 * math.pi * frequency * (np.arange(frames) / self.sample_rate)
        age = n / self.sample_rate
        duration = voice.duration_samples / self.sample_rate

        # Sesin biraz "canli" olmasi icin her ses (voice) kendi sabit seed'inden
        # turetilen kucuk bir detune degeri tasir; bu, gercek piyano/yaylida
        # birden fazla telin/oyuncunun hafif uyumsuzlugunu (unison chorus) taklit eder.
        detune_unit = ((voice.seed % 9973) / 9973.0) - 0.5  # -0.5..0.5

        if voice.kind in ("piano", "piano_soft"):
            attack = np.minimum(1.0, age / 0.010)
            decay_rate = 4.1 if voice.kind == "piano" else 2.5
            env = attack * np.exp(-age * decay_rate)
            detune_ratio = 2.0 ** ((3.2 * detune_unit) / 1200.0)
            fundamental = 0.55 * np.sin(phase) + 0.45 * np.sin(phase * detune_ratio)
            # Hafif inharmonisite: ust kismaller tam katsayidan az saparak gercek
            # tel gerginligini taklit eder (2.005, 3.99, 6.02 gibi).
            signal = (
                fundamental
                + 0.30 * np.sin(phase * 2.005 + 0.2)
                + 0.14 * np.sin(phase * 3.99 + 0.5)
                + 0.06 * np.sin(phase * 6.02 + 0.9)
            ) / 1.60
            if voice.kind == "piano":
                rng = np.random.default_rng(voice.seed + voice.age_samples)
                hammer_env = np.exp(-age * 600.0)
                signal = signal + 0.05 * hammer_env * rng.standard_normal(frames)
        elif voice.kind == "bass":
            env = np.minimum(1.0, age / 0.018) * np.exp(-age * 3.0)
            raw = 0.86 * np.sin(phase) + 0.14 * np.sin(phase * 2.0)
            signal = np.tanh(raw * 1.4) / math.tanh(1.4)
        elif voice.kind in ("strings", "pad"):
            attack_time = 0.32 if voice.kind == "strings" else 0.62
            release_time = 0.62
            env = np.minimum(1.0, age / attack_time) * np.minimum(1.0, np.maximum(0.0, duration - age) / release_time)
            vibrato = 0.0025 * np.sin(2.0 * math.pi * 4.8 * t)
            detune_ratio = 2.0 ** ((5.0 * detune_unit) / 1200.0)
            phase_v = phase + vibrato
            phase_v2 = phase * detune_ratio + vibrato * 1.08
            harmonics = sum((1.0 / h) * np.sin(phase_v * h) for h in range(1, 5))
            harmonics2 = sum((1.0 / h) * np.sin(phase_v2 * h) for h in range(1, 5))
            signal = (0.6 * harmonics + 0.4 * harmonics2) / 1.95
            if voice.kind == "pad":
                signal = 0.72 * signal + 0.28 * np.sin(phase * 0.5)
        elif voice.kind in ("baglama", "guitar"):
            # Karplus-Strong dijital dalga kilavuzu (physical modeling): bir
            # gurultu patlamasi, uzunlugu frekansa bagli dairesel bir gecikme
            # hattinda dolasip her turda hafifce alcak-gecirilerek sonumlenir.
            # Bkz. README (Kaynaklar) - Karplus & Strong 1983; luciopaiva/karplus.
            # Gitar, baglamaya gore daha parlak baslangic ve daha uzun sustain
            # ile (celik tel karakteri) ayni algoritmayi kullanir.
            if voice.kind == "guitar":
                decay_low, decay_high, burst_tone = 0.9975, 0.9955, 0.7
            else:
                decay_low, decay_high, burst_tone = 0.9965, 0.9935, 0.5
            signal = self._karplus_strong_pluck(voice, frames, frequency, decay_low, decay_high, burst_tone)
            env = np.ones(frames, dtype=np.float64)
        elif voice.kind == "keman":
            # Keman (yayli, solo): baglamaya/yayli topluluguna gore daha
            # ifadeli - vibrato zamanla derinlesir (gercek yay teknigi gibi),
            # hafif yay gurultusu ataktadir.
            attack_time, release_time = 0.16, 0.4
            env = np.minimum(1.0, age / attack_time) * np.minimum(1.0, np.maximum(0.0, duration - age) / release_time)
            vibrato_depth = np.minimum(1.0, age / 0.35) * 0.006
            vibrato = vibrato_depth * np.sin(2.0 * math.pi * 5.2 * t)
            phase_v = phase + vibrato
            rng = np.random.default_rng(voice.seed + voice.age_samples)
            bow_noise = rng.standard_normal(frames) * 0.02 * np.exp(-age * 12.0)
            signal = sum((1.0 / h) * np.sin(phase_v * h) for h in range(1, 6)) / 2.28 + bow_noise
        elif voice.kind == "davul":
            # Geleneksel buyuk cerceve davulu: dusuk notada derin "dum"
            # darbesi, yuksek notada keskin "tek" (deynek) sesi.
            if voice.midi_note >= 60:
                rng = np.random.default_rng(voice.seed + voice.age_samples)
                env = np.exp(-age * 60.0)
                signal = 0.6 * rng.standard_normal(frames) * np.exp(-age * 140.0) + 0.4 * np.sin(2.0 * math.pi * 320.0 * t)
            else:
                env = np.exp(-age * 12.0)
                swept = 2.0 * math.pi * (55.0 * age + 30.0 * (1.0 - np.exp(-age * 10.0)))
                signal = np.sin(swept)
        elif voice.kind == "flute":
            # Tahta uflemeli (woodwind): saf sinuse yakin, hafif nefes gurultulu.
            attack_time, release_time = 0.12, 0.35
            env = np.minimum(1.0, age / attack_time) * np.minimum(1.0, np.maximum(0.0, duration - age) / release_time)
            vibrato = 0.004 * np.sin(2.0 * math.pi * 5.5 * t)
            phase_v = phase + vibrato
            rng = np.random.default_rng(voice.seed + voice.age_samples)
            breath = rng.standard_normal(frames) * 0.045
            signal = (np.sin(phase_v) + 0.08 * np.sin(phase_v * 2.0) + 0.03 * np.sin(phase_v * 3.0)) / 1.11 + breath
        elif voice.kind == "brass":
            # Bakir uflemeli: yavas atakla zenginlesen harmonik yigin + hafif doygunluk.
            attack_time, release_time = 0.09, 0.28
            env = np.minimum(1.0, age / attack_time) ** 1.5 * np.minimum(1.0, np.maximum(0.0, duration - age) / release_time)
            raw = sum((1.0 / h) * np.sin(phase * h) for h in range(1, 7)) / 2.45
            signal = np.tanh(raw * 1.6) / math.tanh(1.6)
        elif voice.kind == "ney":
            # Ney (kaval/nefesli kamis): belirgin nefes sesiyle baslayan, yumusak
            # surekli tonlu makam nefeslisi.
            attack_time, release_time = 0.18, 0.5
            env = np.minimum(1.0, age / attack_time) * np.minimum(1.0, np.maximum(0.0, duration - age) / release_time)
            rng = np.random.default_rng(voice.seed + voice.age_samples)
            breath_env = np.exp(-age * 6.0) * 0.35 + 0.06
            breath = rng.standard_normal(frames) * breath_env
            vibrato = 0.0035 * np.sin(2.0 * math.pi * 4.2 * t)
            phase_v = phase + vibrato
            signal = (np.sin(phase_v) + 0.18 * np.sin(phase_v * 2.0 + 0.3)) / 1.18 + breath
        elif voice.kind == "kick":
            env = np.exp(-age * 23.0)
            swept = 2.0 * math.pi * (50.0 * age + 43.0 * (1.0 - np.exp(-age * 19.0)))
            rng = np.random.default_rng(voice.seed + voice.age_samples)
            click_env = np.exp(-age * 900.0)
            signal = np.sin(swept) + 0.18 * click_env * rng.standard_normal(frames)
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

        # Notanin kesildigi ana kisa (~12ms) bir sonme rampasi eklenir; boylece
        # voice.duration_samples'a ulasildiginda ani kesilme (click/pop) olusmaz.
        release_samples = max(1.0, 0.012 * self.sample_rate)
        remaining = voice.duration_samples - n
        tail_fade = np.clip(remaining / release_samples, 0.0, 1.0)

        signal = np.asarray(signal * env * tail_fade * voice.velocity, dtype=np.float32)
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
        self._wav_lock = threading.Lock()
        self._wav_frames: List[np.ndarray] = []
        self.wav_recording = False
        self.consecutive_errors = 0
        self._low_latency_preference = False

    def start_wav_capture(self) -> None:
        with self._wav_lock:
            self._wav_frames = []
            self.wav_recording = True

    def stop_wav_capture(self) -> Optional[np.ndarray]:
        with self._wav_lock:
            self.wav_recording = False
            frames = self._wav_frames
            self._wav_frames = []
        if not frames:
            return None
        return np.concatenate(frames, axis=0)

    def start(self, low_latency: bool = False) -> bool:
        self._low_latency_preference = low_latency
        if not SOUNDDEVICE_AVAILABLE:
            with self.state.lock:
                self.state.audio_status = "SOUNDDEVICE YOK"
            return False
        if self.running:
            return True
        try:
            self.pitch_tracker.start()
            extra_settings = None
            used_exclusive = False
            if low_latency and os.name == "nt" and hasattr(sd, "WasapiSettings"):
                # WASAPI exclusive modu, Windows'ta paylasimli (shared) moda
                # gore host tarafindaki ek arabellek gecikmesini büyük olcude
                # azaltir. Aygit baska bir uygulama tarafindan kullaniliyorsa
                # veya formati desteklemiyorsa basarisiz olabilir; bu durumda
                # asagida sessizce paylasimli moda dusulur.
                try:
                    extra_settings = sd.WasapiSettings(exclusive=True)
                except Exception:
                    extra_settings = None
            try:
                self.stream = sd.Stream(
                    samplerate=AUDIO_SR,
                    blocksize=AUDIO_BLOCK,
                    dtype="float32",
                    channels=(AUDIO_CHANNELS_IN, AUDIO_CHANNELS_OUT),
                    latency="low",
                    callback=self._callback,
                    extra_settings=extra_settings,
                )
                self.stream.start()
                used_exclusive = extra_settings is not None
            except Exception:
                if extra_settings is None:
                    raise
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
                self.state.audio_status = "MIC + VOCAL FX ONLINE" + (" (WASAPI EXCLUSIVE)" if used_exclusive else "")
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
        if self.synth.fluid is not None:
            self.synth.fluid.close()

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
            if self.wav_recording:
                with self._wav_lock:
                    self._wav_frames.append(mix.copy())

            output_level = float(np.sqrt(np.mean(mix * mix) + 1e-12))
            callback_ms = (time.perf_counter() - started) * 1000.0
            with self.state.lock:
                self.state.vocal_level = vocal_level
                self.state.output_level = output_level
                self.state.waveform = waveform
                self.state.latency_ms = callback_ms + AUDIO_BLOCK / AUDIO_SR * 1000.0
                if status:
                    self.state.audio_status = f"AUDIO WARN: {status}"
            self.consecutive_errors = 0
        except Exception as exc:
            outdata.fill(0)
            self.callback_errors.append(str(exc))
            self.consecutive_errors += 1
            with self.state.lock:
                self.state.audio_status = f"CALLBACK ERROR: {str(exc)[:30]}"

    def restart_if_unhealthy(self, threshold: int = 60) -> bool:
        """Ust uste cok sayida callback hatasi (ornegin aygit degisimi/uyku
        sonrasi) sonrasinda ses akisini durdurup yeniden baslatmayi dener."""
        if self.consecutive_errors < threshold:
            return False
        self.consecutive_errors = 0
        self.stop()
        # Thread'ler yeniden baslatilamaz; yeni bir PitchTracker orneklenir.
        self.pitch_tracker = PitchTracker(self.state, self.pitch_tracker.sample_rate)
        return self.start(low_latency=getattr(self, "_low_latency_preference", False))

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
        self.backend_name = ""
        self.opened = threading.Event()

    def _candidate_backends(self) -> List[int]:
        if os.name == "nt":
            # DSHOW bazi kameralarda/surucu kombinasyonlarinda acilamiyor veya
            # kare vermiyor; MSMF ve genel (ANY) sirayla denenir.
            return [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
        return [cv2.CAP_ANY]

    def _open(self) -> bool:
        # ONEMLI: cozunurluk/FPS/FOURCC gibi ozellikler kamera hicbir kare
        # vermeden ONCE zorlanirsa, bircok gercek webcam'de (ozellikle DSHOW
        # ile) kamera tamamen sessiz kalir. Bu yuzden once HICBIR ozellik
        # degistirmeden kameranin yerel/varsayilan ayarlarla kare verip
        # vermedigi dogrulanir; yalnizca bu basarili olduktan SONRA cozunurluk
        # icin en iyi caba (best-effort) bir ayar denenir ve isi bozarsa geri
        # alinir.
        last_exc = ""
        for backend in self._candidate_backends():
            try:
                cap = cv2.VideoCapture(self.index, backend)
                if not cap.isOpened():
                    cap.release()
                    continue
                ok = False
                for _ in range(8):
                    ok, frame = cap.read()
                    if ok and frame is not None:
                        break
                    time.sleep(0.05)
                if not ok:
                    cap.release()
                    continue

                try:
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                    cap.set(cv2.CAP_PROP_FPS, self.fps)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    still_ok = False
                    for _ in range(3):
                        still_ok, _frame = cap.read()
                        if still_ok:
                            break
                        time.sleep(0.05)
                    if not still_ok:
                        # Cozunurluk degisikligi kamerayi bozdu (bazi
                        # webcam'lerde olur); hicbir ozellik zorlamadan
                        # yeniden ac ve yerel ayarlarla devam et.
                        cap.release()
                        cap = cv2.VideoCapture(self.index, backend)
                        if not cap.isOpened():
                            continue
                except Exception:
                    pass

                self.cap = cap
                self.backend_name = {
                    cv2.CAP_DSHOW: "DSHOW", cv2.CAP_MSMF: "MSMF", cv2.CAP_ANY: "ANY",
                }.get(backend, str(backend))
                return True
            except Exception as exc:  # pragma: no cover - donanim/surucu bagimliligi
                last_exc = str(exc)
                continue
        if last_exc:
            self.last_error = f"Kamera acilamadi ({self.index}): {last_exc}"
        else:
            self.last_error = (
                f"Kamera acilamadi (index {self.index}): hicbir backend kare vermedi. "
                "Windows Ayarlar > Gizlilik ve guvenlik > Kamera > "
                "'Uygulamalarin kameraya erismesine izin ver' acik mi kontrol et."
            )
        return False

    def run(self) -> None:
        if not self._open():
            if not self.last_error:
                self.last_error = f"Kamera acilamadi (index {self.index})"
            with self.state.lock:
                self.state.camera_status = "CAMERA ERROR"
            self.opened.set()
            return
        self.opened.set()
        with self.state.lock:
            self.state.camera_status = f"CAMERA ONLINE ({self.backend_name})"
        count = 0
        consecutive_failures = 0
        measured_at = time.perf_counter()
        while not self.stop_event.is_set():
            ok, frame = self.cap.read() if self.cap is not None else (False, None)
            if not ok or frame is None:
                consecutive_failures += 1
                self.last_error = "Kamera karesi alınamadı"
                # ~0.9 saniye ust uste basarisizlik sonrasi cihazi yeniden acmayi dene
                # (USB kamera cikip takilmasi veya baska bir uygulamanin devralmasi gibi durumlar icin).
                if consecutive_failures >= 90:
                    with self.state.lock:
                        self.state.camera_status = "CAMERA RECONNECTING"
                    if self.cap is not None:
                        self.cap.release()
                        self.cap = None
                    if self._open():
                        consecutive_failures = 0
                        with self.state.lock:
                            self.state.camera_status = "CAMERA ONLINE"
                    else:
                        time.sleep(0.5)
                else:
                    time.sleep(0.01)
                continue
            consecutive_failures = 0
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
        self.layer_order = [
            "STRINGS", "PAD", "BASS", "DRUMS", "BAGLAMA", "WOODWINDS", "BRASS", "NEY",
            "GITAR", "KEMAN", "DAVUL",
        ]
        self.last_palm: Dict[str, Tuple[Point, float, float]] = {}
        self.brightness_smooth = 1.0
        self.articulation_smooth = 0.5

    def _allowed(self, event: str, cooldown: float = 1.1) -> bool:
        now = time.time()
        previous = self.last_event.get(event, 0.0)
        if now - previous < cooldown:
            return False
        self.last_event[event] = now
        return True

    def _update_expression(self, hands: Sequence[HandPacket]) -> None:
        """El aciklik derecesi ve hareket hizindan surekli (binary olmayan)
        tonal kontrol turetir: aciklik -> parlaklik, hiz -> artikulasyon."""
        now = time.time()
        if not hands:
            self.brightness_smooth = lerp(self.brightness_smooth, 1.0, 0.05)
            self.articulation_smooth = lerp(self.articulation_smooth, 0.5, 0.05)
            self.audio.synth.set_brightness(self.brightness_smooth)
            self.audio.synth.set_articulation(self.articulation_smooth)
            self.last_palm.clear()
            return

        openness_values = [clamp((hand.openness - 0.55) / 0.65, 0.0, 1.0) for hand in hands]
        target_brightness = lerp(0.15, 1.0, float(np.mean(openness_values)))

        speeds: List[float] = []
        seen_labels = set()
        for hand in hands:
            seen_labels.add(hand.label)
            previous = self.last_palm.get(hand.label)
            if previous is not None:
                prev_point, prev_time, prev_size = previous
                dt = max(1.0 / 90.0, now - prev_time)
                speeds.append(dist(hand.palm_center, prev_point) / max(prev_size, 1.0) / dt)
            self.last_palm[hand.label] = (hand.palm_center, now, hand.hand_size)
        for label in list(self.last_palm.keys()):
            if label not in seen_labels:
                del self.last_palm[label]

        if speeds:
            speed_norm = clamp(max(speeds) / 3.2, 0.0, 1.0)
            target_articulation = clamp(1.0 - speed_norm, 0.0, 1.0)
        else:
            target_articulation = self.articulation_smooth

        self.brightness_smooth = lerp(self.brightness_smooth, target_brightness, 0.15)
        self.articulation_smooth = lerp(self.articulation_smooth, target_articulation, 0.15)
        self.audio.synth.set_brightness(self.brightness_smooth)
        self.audio.synth.set_articulation(self.articulation_smooth)

    def update(self, hands: Sequence[HandPacket]) -> None:
        self._update_expression(hands)
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
# OTOMATIK DUZENLEME (AUTO-ARRANGER)
# -----------------------------------------------------------------------------

class AutoArranger:
    """Tonalite sistemi (Bati/Makam), tempo ve ritim hissine (aksak/duz) gore
    her sarkiya uygun makul bir varsayilan enstruman/katman seti onerir.

    Bu, gercek bir tur/enstruman siniflandirici DEGILDIR (bunun icin ses
    ozellik cikarimi ve egitilmis bir model gerekir - bkz. README, Kapsam
    disi birakilanlar). Yalnizca zaten hesaplanan tonal_system/bpm/rhythm_feel
    degerlerine bakan kural tabanli bir sezgiseldir. Kullanicinin jest ile
    yaptigi katman degisiklikleri her zaman gecerlidir; bu yalnizca belirgin
    bir degisim oldugunda (en fazla ~6 saniyede bir) yeni bir taban onerir.
    """

    def __init__(self, state: RuntimeState, synth: SynthEngine) -> None:
        self.state = state
        self.synth = synth
        self.enabled = True
        self.last_signature: Optional[Tuple[str, str, str]] = None
        self.last_applied = 0.0

    def toggle(self) -> bool:
        self.enabled = not self.enabled
        if not self.enabled:
            self.last_signature = None
        with self.state.lock:
            self.state.auto_arrange_enabled = self.enabled
        return self.enabled

    def update(self) -> None:
        if not self.enabled:
            return
        now = time.monotonic()
        if now - self.last_applied < 6.0:
            return
        with self.state.lock:
            tonal_system = self.state.music.tonal_system
            bpm = self.state.music.bpm
            feel = self.state.music.rhythm_feel
        tempo_bucket = "hizli" if bpm >= 105.0 else ("yavas" if bpm < 80.0 else "orta")
        signature = (tonal_system, tempo_bucket, feel)
        if signature == self.last_signature:
            return
        self.last_signature = signature
        self.last_applied = now

        if tonal_system == "makam":
            if feel == "aksak":
                # Anadolu rock/halk oyunu havasi: bagimsiz ritim + bas destegi.
                preset = {"PIANO", "BAGLAMA", "NEY", "BASS", "DRUMS"}
            else:
                # Alaturka/klasik/taksim havasi: ritimsiz, dron agirlikli.
                preset = {"PIANO", "BAGLAMA", "NEY", "PAD"}
        else:
            if tempo_bucket == "hizli":
                preset = {"PIANO", "BASS", "DRUMS", "STRINGS"}
            elif tempo_bucket == "yavas":
                preset = {"PIANO", "PAD", "STRINGS"}
            else:
                preset = {"PIANO", "BASS", "STRINGS", "PAD"}
        self.synth.set_layers(preset)


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

        with self.state.lock:
            simple_mode = self.state.simple_mode
        if self.hud_enabled:
            if simple_mode:
                self._draw_simple_hud(img)
            else:
                self._draw_header(img)
                self._draw_music_card(img)
                self._draw_vocal_card(img)
                self._draw_orchestra_card(img)
                self._draw_bottom_deck(img)
        with self.state.lock:
            show_guide = self.state.show_guide
        if show_guide:
            self._draw_guide_overlay(img)
        return img

    def _draw_simple_hud(self, img: np.ndarray) -> None:
        """gesturesynth.com'dan ilham alinan minimal 'Basit Mod': kamera
        goruntusu arayuzun kendisi, ustunde yalnizca en onemli bilgi (su an
        duyulan nota + eslik) ve alt tarafta hangi enstrumanlarin caldigina
        dair kompakt bir serit var. Tam gosterge paneli (Gelismis Mod) hicbir
        sey kaybetmeden `Tab` ile her an acilabilir."""
        theme = self.theme
        h, w = img.shape[:2]
        with self.state.lock:
            pitch = PitchSnapshot(**vars(self.state.pitch))
            music = MusicSnapshot(**vars(self.state.music))
            layers = set(self.state.active_layers)
            audio_status = self.state.audio_status
            camera_status = self.state.camera_status

        card_w, card_h = 620, 118
        cx, cy = w // 2 - card_w // 2, 22
        accent = theme.accent if music.tonal_system == "makam" else theme.secondary
        self._soft_card(img, cx, cy, card_w, card_h, alpha=0.94, radius=20, accent=accent)

        if " - " in music.chord_name:
            main_name, detail_name = music.chord_name.split(" - ", 1)
        else:
            main_name, detail_name = music.chord_name, ""
        draw_text(img, "ESLIK", cx + 28, cy + 28, 0.26, theme.muted, 1)
        draw_text(img, main_name[:18], cx + 26, cy + 68, 0.88, theme.text, 2)
        caption = detail_name if detail_name else f"{music.bpm:0.0f} BPM"
        draw_text(img, caption[:30], cx + 28, cy + 92, 0.30, theme.muted, 1)

        note_text = pitch.note_name if pitch.voiced else "--"
        draw_text(img, "SESIN", cx + card_w - 168, cy + 28, 0.26, theme.muted, 1)
        draw_text(img, note_text, cx + card_w - 170, cy + 74, 0.9, theme.primary, 2)
        badge_text = "MAKAM" if music.tonal_system == "makam" else "BATI"
        self._pill(img, cx + card_w - 92, cy + card_h - 30, 70, 22, accent, badge_text, theme.bg, 0.26)

        # Sol ust: durum noktasi (kamera+ses hazir mi)
        online = "ONLINE" in audio_status
        cam_online = "ONLINE" in camera_status
        ready = online and cam_online
        cv2.circle(img, (28, 28), 7, theme.success if ready else theme.warning, -1, cv2.LINE_AA)
        status_label = "Hazir" if ready else ("Kamera bekleniyor" if not cam_online else "Ses bekleniyor")
        draw_text(img, status_label, 44, 33, 0.27, theme.muted, 1)

        # Alt orta: su an calan katmanlar, tek satirlik kompakt serit.
        ordered_layers = sorted(layers, key=lambda name: LAYER_KEY_BY_NAME.get(name, "~"))
        active_names = [LAYER_LABEL_BY_NAME.get(name, name) for name in ordered_layers]
        row_text = " | ".join(active_names) if active_names else "Sessiz"
        text_w = cv2.getTextSize(row_text[:80], cv2.FONT_HERSHEY_SIMPLEX, 0.30, 1)[0][0]
        strip_w = min(w - 80, text_w + 48)
        strip_x = w // 2 - strip_w // 2
        strip_h = 48
        strip_y = h - strip_h - 24
        self._soft_card(img, strip_x, strip_y, strip_w, strip_h, alpha=0.90, radius=16)
        draw_text(img, "CALAN ENSTRUMANLAR", strip_x + 18, strip_y + 17, 0.22, theme.muted, 1)
        draw_text(img, row_text[:80], strip_x + 18, strip_y + 38, 0.28, theme.text, 1)

        hint = "Gelismis gorunum: Tab  |  Kilavuz: /"
        hint_w = cv2.getTextSize(hint, cv2.FONT_HERSHEY_SIMPLEX, 0.24, 1)[0][0]
        draw_text(img, hint, w - hint_w - 20, h - 16, 0.24, theme.muted, 1)

    def _draw_guide_overlay(self, img: np.ndarray) -> None:
        """Tam ekran kullanim kilavuzu: hangi jest/tus hangi enstrumani
        kontrol ediyor. '/' ile ac/kapat."""
        theme = self.theme
        h, w = img.shape[:2]
        dim = img.copy()
        dim[:] = theme.bg
        alpha_blend(img, dim, 0.86)

        panel_w, panel_h = min(920, w - 80), min(560, h - 80)
        px, py = (w - panel_w) // 2, (h - panel_h) // 2
        self._soft_card(img, px, py, panel_w, panel_h, alpha=0.97, radius=18, accent=theme.primary)
        draw_text(img, "KULLANIM KILAVUZU", px + 28, py + 40, 0.52, theme.text, 2)
        draw_text(img, "Kapatmak icin '/' tusuna tekrar bas", px + 28, py + 62, 0.28, theme.muted, 1)

        col1_x = px + 28
        col2_x = px + panel_w // 2 + 10
        row_y = py + 100

        draw_text(img, "JESTLER (ELLER SERBEST)", col1_x, row_y, 0.30, theme.accent, 1)
        gestures = [
            ("Sag acik el", "Yaylilar (Strings) ac"),
            ("Sol acik el", "Pad ac"),
            ("Iki acik el (tut)", "Tam orkestra + mesafeyle yogunluk"),
            ("Peace (V)", "Ritim ac/kapat"),
            ("Yumruk", "Ek katmanlari sustur"),
            ("Isaret parmagi", "Katmanlar arasinda sirayla sec"),
            ("Pinch (basparmak+isaret)", "Reverb/echo miktari"),
            ("El acikligi (surekli)", "Parlaklik (ton koyu<->parlak)"),
            ("El hareket hizi (surekli)", "Artikulasyon (legato<->staccato)"),
        ]
        gy = row_y + 26
        for label, effect in gestures:
            draw_text(img, label, col1_x, gy, 0.27, theme.text, 1)
            draw_text(img, effect, col1_x, gy + 17, 0.24, theme.muted, 1)
            gy += 38

        draw_text(img, "ENSTRUMAN TUSLARI (HER ZAMAN GECERLI)", col2_x, row_y, 0.30, theme.accent, 1)
        ky = row_y + 26
        key_items = sorted(LAYER_KEYS.items(), key=lambda item: item[1][1])
        for key_char, (_layer, label) in key_items:
            badge_x, badge_y = col2_x, ky - 12
            rounded_rect(img, (badge_x, badge_y), (badge_x + 20, badge_y + 18), theme.panel2, radius=4, thickness=-1)
            draw_text(img, key_char.upper(), badge_x + 5, badge_y + 14, 0.28, theme.accent, 1)
            draw_text(img, label, badge_x + 30, ky, 0.27, theme.text, 1)
            ky += 24

        other_y = ky + 16
        draw_text(img, "DIGER TUSLAR", col2_x, other_y, 0.30, theme.accent, 1)
        other_keys = (
            "Tab basit/gelismis gorunum  |  T tonalite (Bati/Makam)  |  D dizi rengi  |  A oto-duzenleme\n"
            "F tam orkestra  |  X sadece piyano  |  R kayit (video+wav+midi)  |  S ekran goruntusu  |  1-4 tema\n"
            "H arayuz  |  E vokal fx  |  V monitoring  |  Space tap tempo  |  [ ] bpm  |  - + reverb\n"
            "9 0 piyano seviyesi  |  M ayna  |  Q/Esc cikis"
        )
        oy = other_y + 22
        for line in other_keys.split("\n"):
            draw_text(img, line, col2_x, oy, 0.24, theme.muted, 1)
            oy += 20

    def _soft_grade(self, frame: np.ndarray) -> np.ndarray:
        # convertScaleAbs, tam-kare float dönüşümünden daha ucuzdur.
        theme = self.theme
        if theme.dark:
            # Koyu stüdyo temalarında kamera görüntüsü hafifçe karartılıp
            # soğutulur; böylece parlak panel/metin katmanları daha net öne çıkar.
            graded = cv2.convertScaleAbs(frame, alpha=0.72, beta=-6)
            graded = graded.astype(np.int16)
            graded[:, :, 0] = np.clip(graded[:, :, 0] + 6, 0, 255)  # B kanalini hafif yukselt
            graded[:, :, 2] = np.clip(graded[:, :, 2] - 4, 0, 255)  # R kanalini hafif dusur
            return graded.astype(np.uint8)
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

    def _soft_card(
        self, img: np.ndarray, x: int, y: int, w: int, h: int, alpha: float = 0.90, radius: int = 16,
        accent: Optional[Color] = None,
    ) -> None:
        """Duz/modern stüdyo paneli: ince kenarlik, hafif golge ve ustte
        (opsiyonel) ince renkli aksan seridi - profesyonel DAW panellerindeki
        gibi bir "baslik serit" hissi verir."""
        theme = self.theme
        shadow = img.copy()
        offset = 3 if theme.dark else 5
        rounded_rect(shadow, (x + offset, y + offset + 1), (x + w + offset, y + h + offset + 1), (0, 0, 0), radius=radius, thickness=-1)
        alpha_blend(img, shadow, 0.30 if theme.dark else 0.07)
        overlay = img.copy()
        rounded_rect(overlay, (x, y), (x + w, y + h), theme.panel, radius=radius, thickness=-1)
        alpha_blend(img, overlay, alpha)
        rounded_rect(img, (x, y), (x + w, y + h), theme.panel2, radius=radius, thickness=1)
        if accent is not None:
            # Yuvarlatilmis kosevi asmamak icin serit, sol/sag radius kadar
            # icerden baslar (tam-kare boyutunda maske olusturmaktan kacinilir).
            cv2.rectangle(img, (x + radius, y + 1), (x + w - radius, y + 3), accent, -1, cv2.LINE_AA)

    def _pill(self, img: np.ndarray, x: int, y: int, w: int, h: int, fill: Color, text: str, text_color: Optional[Color] = None, scale: float = 0.34) -> None:
        rounded_rect(img, (x, y), (x + w, y + h), fill, radius=h // 2, thickness=-1)
        tw, th = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)[0]
        draw_text(img, text, x + max(8, (w - tw) // 2), y + (h + th) // 2 - 2, scale, text_color or self.theme.text, 1)

    def _progress(self, img: np.ndarray, x: int, y: int, w: int, value: float, color: Color) -> None:
        value = clamp(value, 0.0, 1.0)
        rounded_rect(img, (x, y), (x + w, y + 7), self.theme.panel2, radius=4, thickness=-1)
        if value > 0.01:
            rounded_rect(img, (x, y), (x + max(8, int(w * value)), y + 7), color, radius=4, thickness=-1)

    def _led_meter(self, img: np.ndarray, x: int, y: int, w: int, h: int, value: float, color: Color, segments: int = 20) -> None:
        """Profesyonel ses ekipmanlarindaki segmentli LED VU-metre gorunumu."""
        theme = self.theme
        value = clamp(value, 0.0, 1.0)
        gap = 3
        seg_w = (w - gap * (segments - 1)) / segments
        lit = int(round(value * segments))
        for i in range(segments):
            sx = int(x + i * (seg_w + gap))
            active = i < lit
            if active:
                t = i / max(segments - 1, 1)
                fill = color if t < 0.78 else tuple(int(color[c] * 0.5 + theme.warning[c] * 0.5) for c in range(3))
            else:
                fill = theme.panel2
            cv2.rectangle(img, (sx, y), (int(sx + seg_w), y + h), fill, -1, cv2.LINE_AA)

    def _draw_header(self, img: np.ndarray) -> None:
        theme = self.theme
        h, w = img.shape[:2]
        self._soft_card(img, 24, 20, 330, 66, alpha=0.94, radius=14, accent=theme.primary)
        cv2.circle(img, (48, 53), 4, theme.primary, -1, cv2.LINE_AA)
        cv2.circle(img, (48, 53), 8, theme.primary, 1, cv2.LINE_AA)
        draw_text(img, "HARMONI", 62, 54, 0.62, theme.text, 2)
        draw_text(img, f"v3.8  |  tema {theme.name.title()}", 63, 75, 0.28, theme.muted, 1)

        self._soft_card(img, w - 354, 20, 330, 66, alpha=0.94, radius=14)
        with self.state.lock:
            audio_status = self.state.audio_status
            camera_status = self.state.camera_status
            latency = self.state.latency_ms
            camera_fps = self.state.camera_fps
            detector_fps = self.state.detector_fps
        online = "ONLINE" in audio_status
        cam_online = "ONLINE" in camera_status
        dot_color = theme.success if online else theme.danger
        cv2.circle(img, (w - 328, 52), 5, dot_color, -1, cv2.LINE_AA)
        status_text = "Dinliyor ve eslik ediyor" if online else "Ses sistemi beklemede"
        draw_text(img, status_text, w - 312, 56, 0.35, theme.text, 1)
        cam_dot = theme.success if cam_online else theme.danger
        cv2.circle(img, (w - 328, 73), 4, cam_dot, -1, cv2.LINE_AA)
        fps = float(np.mean(self.fps_history)) if self.fps_history else 0.0
        draw_text(img, f"kamera {camera_fps:0.0f}fps  el {detector_fps:0.0f}fps  arayuz {fps:0.0f}fps  {latency:0.0f}ms", w - 312, 77, 0.23, theme.muted, 1)

    def _draw_vocal_card(self, img: np.ndarray) -> None:
        theme = self.theme
        x, y, w, h = 24, 112, 252, 344
        self._soft_card(img, x, y, w, h, alpha=0.92, accent=theme.secondary)
        with self.state.lock:
            pitch = PitchSnapshot(**vars(self.state.pitch))
            music = MusicSnapshot(**vars(self.state.music))
            vocal_level = self.state.vocal_level

        draw_text(img, "VOKAL", x + 20, y + 34, 0.38, theme.muted, 1)
        note_text = pitch.note_name if pitch.voiced else "--"
        if theme.dark:
            # Ucuz "glow": Gaussian blur yerine hafif koyu golge + parlak metin.
            draw_text(img, note_text, x + 20, y + 124, 1.42, (0, 0, 0), 3)
        draw_text(img, note_text, x + 18, y + 122, 1.42, theme.primary, 2)
        draw_text(img, f"{pitch.frequency:0.1f} Hz", x + 142, y + 103, 0.38, theme.text, 1)
        if music.tonal_system == "makam" and pitch.voiced:
            perde_name, perde_offset = nearest_perde_name(pitch.frequency)
            draw_text(img, f"{perde_name} {perde_offset:+0.0f}c", x + 142, y + 126, 0.29, theme.muted, 1)
        else:
            draw_text(img, f"{pitch.cents:+0.1f} cent", x + 142, y + 126, 0.29, theme.muted, 1)

        draw_text(img, "NOTA NETLIGI", x + 20, y + 166, 0.28, theme.muted, 1)
        draw_text(img, f"{int(pitch.confidence * 100)}%", x + w - 62, y + 166, 0.28, theme.text, 1)
        self._led_meter(img, x + 20, y + 174, w - 40, 10, pitch.confidence, theme.primary)

        level = clamp(vocal_level * 11.0, 0.0, 1.0)
        draw_text(img, "SES SEVIYESI", x + 20, y + 211, 0.28, theme.muted, 1)
        draw_text(img, f"{int(level * 100)}%", x + w - 62, y + 211, 0.28, theme.text, 1)
        self._led_meter(img, x + 20, y + 219, w - 40, 10, level, theme.secondary)

        rounded_rect(img, (x + 20, y + 254), (x + w - 20, y + 255), theme.panel2, radius=1, thickness=-1)

        draw_text(img, "TONALITE / MAKAM", x + 20, y + 280, 0.28, theme.muted, 1)
        draw_text(img, music.key_name.title()[:22], x + 20, y + 308, 0.50, theme.text, 1)
        badge_text = "MAKAM" if music.tonal_system == "makam" else "BATI"
        badge_color = theme.accent if music.tonal_system == "makam" else theme.secondary
        self._pill(img, x + w - 92, y + 286, 72, 22, badge_color, badge_text, theme.bg, 0.28)

        fx = self.audio.dsp
        self._pill(img, x + 20, y + 314, 91, 25, theme.panel2, "Dogal", theme.text, 0.30)
        reverb_label = f"Reverb {int(clamp(fx.reverb_mix / 0.24, 0, 1) * 100)}%"
        self._pill(img, x + 119, y + 314, 112, 25, theme.secondary, reverb_label, theme.bg, 0.27)

    def _draw_music_card(self, img: np.ndarray) -> None:
        """'Su anki eslik' kartı; en onemli canli bilgi oldugu icin en ust
        satirda (baslik kartlarinin arasinda), genis ve buyuk yazi ile."""
        theme = self.theme
        h, w = img.shape[:2]
        x = 24 + 330 + 20
        right_edge = (w - 354) - 20
        cw = max(320, right_edge - x)
        y, ch = 14, 78
        with self.state.lock:
            music = MusicSnapshot(**vars(self.state.music))
            pitch = PitchSnapshot(**vars(self.state.pitch))
        accent = theme.accent if music.tonal_system == "makam" else theme.secondary
        self._soft_card(img, x, y, cw, ch, alpha=0.95, radius=16, accent=accent)

        # Vuruş gostergesi: ince halka + donen ibre, stüdyo ekipmanı hissi.
        center = (x + 42, y + ch // 2)
        cv2.circle(img, center, 25, theme.panel2, 2, cv2.LINE_AA)
        cv2.ellipse(img, center, (25, 25), 0, -90, int(-90 + music.beat_phase * 360), theme.primary, 3, cv2.LINE_AA)
        cv2.circle(img, center, 5, theme.primary, -1, cv2.LINE_AA)
        bpm_conf = music.makam_confidence if music.tonal_system == "makam" else music.key_confidence
        cv2.ellipse(img, center, (17, 17), 0, -90, int(-90 + clamp(bpm_conf, 0.0, 1.0) * 360), theme.accent, 2, cv2.LINE_AA)

        text_x = x + 84
        draw_text(img, "SU ANKI ESLIK", text_x, y + 22, 0.26, theme.muted, 1)
        if " - " in music.chord_name:
            main_name, detail_name = music.chord_name.split(" - ", 1)
        else:
            main_name, detail_name = music.chord_name, ""
        draw_text(img, main_name[:22], text_x, y + 54, 0.72, theme.text, 2)
        name_w = cv2.getTextSize(main_name[:22], cv2.FONT_HERSHEY_SIMPLEX, 0.72, 2)[0][0]

        listening = pitch.note_name if pitch.voiced else "dinliyor"
        info_line = f"{detail_name}  |  {music.bpm:0.0f} BPM  |  {listening}" if detail_name else f"{music.bpm:0.0f} BPM  |  {listening}"
        info_x = text_x + name_w + 22
        if info_x < x + cw - 140:
            draw_text(img, info_line[:44], info_x, y + 50, 0.30, theme.muted, 1)
        else:
            draw_text(img, info_line[:44], text_x, y + 70, 0.26, theme.muted, 1)

        badge_text = "MAKAM" if music.tonal_system == "makam" else "BATI"
        self._pill(img, x + cw - 88, y + ch - 30, 70, 22, accent, badge_text, theme.bg, 0.27)

    def _draw_orchestra_card(self, img: np.ndarray) -> None:
        theme = self.theme
        h_img, w_img = img.shape[:2]
        x, y, w, h = w_img - 276, 112, 252, 525
        with self.state.lock:
            layers = set(self.state.active_layers)
            gesture = self.state.gesture
            detail = self.state.gesture_detail
            tonal_system = self.state.music.tonal_system
        self._soft_card(img, x, y, w, h, alpha=0.92, accent=theme.primary)

        with self.state.lock:
            auto_arrange = self.state.auto_arrange_enabled
        draw_text(img, f"ORKESTRA ({len(LAYER_KEYS)} KATMAN)", x + 20, y + 34, 0.32, theme.muted, 1)
        subtitle = "Otomatik duzenleme (A ile kapat)" if auto_arrange else "Manuel kontrol (A ile ac)"
        draw_text(img, subtitle, x + 20, y + 57, 0.24, theme.accent if auto_arrange else theme.muted, 1)

        # Kompakt 2 sutunlu mikser-benzeri izgara; her hucrede dogrudan
        # klavye kisayolu (LAYER_KEYS) rozet olarak gosterilir - "hangi
        # enstruman hangi tusla" sorusunun cevabi HER ZAMAN ekranda.
        layer_order_display = [
            "PIANO", "BAGLAMA", "NEY", "WOODWINDS", "BRASS", "STRINGS",
            "KEMAN", "GITAR", "PAD", "BASS", "DRUMS", "DAVUL",
        ]
        layer_cells = [(name, LAYER_KEY_BY_NAME.get(name, "?"), LAYER_KEYS.get(LAYER_KEY_BY_NAME.get(name, ""), (name, name))[1]) for name in layer_order_display]
        if tonal_system == "makam":
            idx0 = layer_order_display.index("PIANO")
            layer_cells[idx0] = ("PIANO", "P", "Piyano (kapali)")
        col_w = (w - 36 - 8) // 2
        cell_h = 38
        gap = 7
        grid_top = y + 78
        for idx, (layer_name, key_char, label) in enumerate(layer_cells):
            col = idx % 2
            row = idx // 2
            cx = x + 18 + col * (col_w + 8)
            cy = grid_top + row * (cell_h + gap)
            active = layer_name in layers
            fill = tuple(int(theme.panel2[i] * 0.5 + theme.primary[i] * 0.22) for i in range(3)) if active else theme.panel2
            rounded_rect(img, (cx, cy), (cx + col_w, cy + cell_h), fill, radius=9, thickness=-1)
            if active:
                rounded_rect(img, (cx, cy), (cx + col_w, cy + cell_h), theme.primary, radius=9, thickness=1)
            dot = theme.success if active else theme.muted
            cv2.circle(img, (cx + 14, cy + cell_h // 2), 4, dot, -1, cv2.LINE_AA)
            draw_text(img, label, cx + 25, cy + cell_h // 2 + 4, 0.26, theme.text if active else theme.muted, 1)
            badge_x = cx + col_w - 22
            rounded_rect(img, (badge_x, cy + 7), (badge_x + 16, cy + 7 + 16), theme.panel2, radius=4, thickness=-1)
            draw_text(img, key_char.upper(), badge_x + 4, cy + 19, 0.28, theme.accent, 1)
        rows_used = (len(layer_cells) + 1) // 2
        grid_bottom = grid_top + rows_used * cell_h + (rows_used - 1) * gap

        info_y = grid_bottom + 24
        draw_text(img, "ALGILANAN HAREKET", x + 20, info_y, 0.26, theme.muted, 1)
        readable_gesture = gesture.replace("OPEN_HAND", "ACIK EL").replace("RIGHT", "SAG").replace("LEFT", "SOL")
        draw_text(img, readable_gesture[:25], x + 20, info_y + 24, 0.34, theme.text, 1)
        draw_text(img, detail[:30].title(), x + 20, info_y + 43, 0.26, theme.muted, 1)

        brightness = clamp(self.audio.synth.brightness, 0.0, 1.0)
        articulation = clamp(self.audio.synth.articulation, 0.0, 1.0)
        meter_y = info_y + 63
        draw_text(img, "PARLAKLIK", x + 20, meter_y, 0.24, theme.muted, 1)
        self._led_meter(img, x + 20, meter_y + 6, w - 40, 8, brightness, theme.accent, segments=16)
        draw_text(img, "LEGATO", x + 20, meter_y + 30, 0.24, theme.muted, 1)
        self._led_meter(img, x + 20, meter_y + 36, w - 40, 8, articulation, theme.secondary, segments=16)

    def _draw_bottom_deck(self, img: np.ndarray) -> None:
        theme = self.theme
        h, w = img.shape[:2]
        bh = 170
        x, y, bw = 300, h - bh - 24, w - 600
        self._soft_card(img, x, y, bw, bh, alpha=0.92, radius=16)
        draw_text(img, "CANLI AKIS", x + 20, y + 28, 0.32, theme.muted, 1)
        draw_text(img, "Q cikis | E efekt | V monitoring | T makam/bati | D dizi rengi | A oto-duzen | 9/0 piyano | 1-4 tema", x + 128, y + 28, 0.20, theme.muted, 1)
        half_w = (bw - 40 - 16) // 2
        self._draw_waveform(img, x + 20, y + 42, half_w, 42)
        self._draw_spectrum(img, x + 20 + half_w + 16, y + 42, half_w, 42)
        self._draw_keyboard(img, x + 20, y + 91, bw - 40, 49)

    def _draw_hand_skeletons(self, img: np.ndarray, hands: Sequence[HandPacket]) -> None:
        theme = self.theme
        overlay = img.copy()
        for hand in hands:
            color = theme.primary if hand.label == "RIGHT" else theme.secondary
            thickness = 1 if theme.dark else 2
            for a, b in HAND_CONNECTIONS:
                cv2.line(overlay, hand.landmarks[a], hand.landmarks[b], color, thickness, cv2.LINE_AA)
            for idx in (WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP):
                cv2.circle(overlay, hand.landmarks[idx], 2, color, -1, cv2.LINE_AA)
            for idx in (THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP):
                cv2.circle(overlay, hand.landmarks[idx], 4, color, -1, cv2.LINE_AA)
                cv2.circle(overlay, hand.landmarks[idx], 6, color, 1, cv2.LINE_AA)
            cx, cy = hand.palm_center
            label = "Sag el" if hand.label == "RIGHT" else "Sol el"
            label += " - " + hand.gesture.replace("OPEN_HAND", "Acik").replace("FIST", "Kapali").replace("PEACE", "Peace").title()
            tw = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.29, 1)[0][0]
            rounded_rect(overlay, (cx - tw // 2 - 10, cy + 37), (cx + tw // 2 + 10, cy + 62), theme.panel, radius=11, thickness=-1)
            rounded_rect(overlay, (cx - tw // 2 - 10, cy + 37), (cx + tw // 2 + 10, cy + 62), color, radius=11, thickness=1)
            draw_text(overlay, label, cx - tw // 2, cy + 54, 0.29, theme.text, 1)
            if hand.gesture == "PINCH":
                p1, p2 = hand.landmarks[THUMB_TIP], hand.landmarks[INDEX_TIP]
                cv2.line(overlay, p1, p2, theme.accent, 3, cv2.LINE_AA)
        alpha_blend(img, overlay, 0.80 if theme.dark else 0.72)

        if len(hands) >= 2 and all(hand.gesture == "OPEN_HAND" for hand in hands[:2]):
            p1, p2 = hands[0].palm_center, hands[1].palm_center
            bridge = img.copy()
            cv2.line(bridge, p1, p2, theme.accent, 2, cv2.LINE_AA)
            alpha_blend(img, bridge, 0.30)

    def _draw_waveform(self, img: np.ndarray, x: int, y: int, w: int, h: int) -> None:
        theme = self.theme
        with self.state.lock:
            waveform = np.asarray(self.state.waveform, dtype=np.float32).copy()
        rounded_rect(img, (x, y), (x + w, y + h), theme.panel2, radius=6, thickness=-1)
        if waveform.size < 2:
            return
        xs = np.linspace(x, x + w, waveform.size).astype(np.int32)
        center_y = y + h // 2
        cv2.line(img, (x, center_y), (x + w, center_y), theme.panel2, 1, cv2.LINE_AA)
        ys = (center_y - np.clip(waveform, -0.6, 0.6) * (h * 0.42)).astype(np.int32)
        points = np.column_stack((xs, ys)).reshape(-1, 1, 2)
        fill_points = np.vstack([
            points.reshape(-1, 2),
            np.array([[x + w, center_y], [x, center_y]], dtype=np.int32),
        ]).reshape(-1, 1, 2)
        fill = img.copy()
        cv2.fillPoly(fill, [fill_points], theme.primary, cv2.LINE_AA)
        alpha_blend(img, fill, 0.22 if theme.dark else 0.16)
        cv2.polylines(img, [points], False, theme.primary, 2, cv2.LINE_AA)

    def _draw_spectrum(self, img: np.ndarray, x: int, y: int, w: int, h: int) -> None:
        """Girisin (mikrofon) kucuk bir FFT spektrumu; teknik/profesyonel bir
        performans gorunumu icin waveform'un yaninda gosterilir."""
        theme = self.theme
        rounded_rect(img, (x, y), (x + w, y + h), theme.panel2, radius=6, thickness=-1)
        with self.state.lock:
            waveform = np.asarray(self.state.waveform, dtype=np.float32).copy()
        if waveform.size < 8:
            return
        windowed = waveform * np.hanning(waveform.size)
        spectrum = np.abs(np.fft.rfft(windowed))
        bars = 24
        # Insan kulaginin frekans algisina yakin olmasi icin dogrusal degil
        # logaritmik (geometrik) bin gruplama kullanilir.
        edges = np.geomspace(1, max(2, len(spectrum) - 1), bars + 1).astype(int)
        values = np.zeros(bars, dtype=np.float32)
        for i in range(bars):
            lo, hi = edges[i], max(edges[i] + 1, edges[i + 1])
            values[i] = float(np.mean(spectrum[lo:hi]))
        values = np.log1p(values * 40.0)
        peak = float(values.max())
        if peak > 1e-6:
            values = np.clip(values / peak, 0.0, 1.0)
        gap = 2
        bar_w = (w - gap * (bars - 1)) / bars
        for i, v in enumerate(values):
            bx = int(x + i * (bar_w + gap))
            bar_h = max(2, int(v * (h - 4)))
            t = i / max(bars - 1, 1)
            color = tuple(int(theme.secondary[c] * (1 - t) + theme.primary[c] * t) for c in range(3))
            cv2.rectangle(img, (bx, y + h - bar_h - 2), (int(bx + bar_w), y + h - 2), color, -1, cv2.LINE_AA)

    def _draw_keyboard(self, img: np.ndarray, x: int, y: int, width: int, height: int) -> None:
        theme = self.theme
        with self.state.lock:
            chord_notes = set(n % 12 for n in self.state.music.chord_notes)
            pitch_note = self.state.pitch.midi_note % 12 if self.state.pitch.voiced else -1
        white_count = 14
        key_w = width / white_count
        white_pcs = [0, 2, 4, 5, 7, 9, 11]
        white_idle = theme.panel2 if theme.dark else theme.panel
        black_idle = tuple(int(theme.bg[i] * 0.5 + theme.panel2[i] * 0.5) for i in range(3)) if theme.dark else (60, 56, 52)
        for i in range(white_count):
            pc = white_pcs[i % 7]
            x1 = int(x + i * key_w)
            x2 = int(x + (i + 1) * key_w - 2)
            active = pc in chord_notes
            color = theme.primary if active else white_idle
            rounded_rect(img, (x1, y), (x2, y + height), color, radius=4, thickness=-1)
            rounded_rect(img, (x1, y), (x2, y + height), theme.panel2, radius=4, thickness=1)
            if pc == pitch_note:
                rounded_rect(img, (x1 + 3, y + 3), (x2 - 3, y + height - 3), theme.accent, radius=3, thickness=2)
        black_positions = [0, 1, 3, 4, 5]
        black_pcs = [1, 3, 6, 8, 10]
        for octave in range(2):
            base = octave * 7
            for pos, pc in zip(black_positions, black_pcs):
                bx = int(x + (base + pos + 0.70) * key_w)
                key_width = max(8, int(key_w * 0.55))
                active = pc in chord_notes
                color = theme.secondary if active else black_idle
                rounded_rect(img, (bx, y), (bx + key_width, y + int(height * 0.61)), color, radius=3, thickness=-1)
                if pc == pitch_note:
                    rounded_rect(img, (bx + 2, y + 2), (bx + key_width - 2, y + int(height * 0.61) - 2), theme.accent, radius=3, thickness=2)


# -----------------------------------------------------------------------------
# ANA UYGULAMA
# -----------------------------------------------------------------------------

def export_midi(path: Path, events: Sequence[Tuple[float, str, int, float, float]], bpm: float) -> bool:
    """Bir oturumda tetiklenen notalari standart bir .mid dosyasina yazar.
    `mido` kurulu degilse sessizce False doner (cagiran taraf toast ile bilgilendirir)."""
    if not MIDO_AVAILABLE or not events:
        return False
    ticks_per_beat = 480
    seconds_per_beat = 60.0 / max(bpm, 1.0)

    def sec_to_ticks(sec: float) -> int:
        return max(0, int(round(sec / seconds_per_beat * ticks_per_beat)))

    channel_map = {"piano": 0, "piano_soft": 0, "strings": 1, "pad": 2, "bass": 3}
    drum_notes = {"kick": 36, "snare": 38, "hat": 42}

    raw_events: List[Tuple[int, int, int, int, int]] = []  # (tick, is_off, channel, note, velocity)
    for onset, kind, note, velocity, duration in events:
        channel = 9 if kind in drum_notes else channel_map.get(kind, 0)
        midi_note = drum_notes.get(kind, int(clamp(note, 0, 127)))
        vel = max(1, min(127, int(velocity * 127)))
        on_tick = sec_to_ticks(onset)
        off_tick = max(on_tick + 1, sec_to_ticks(onset + max(duration, 0.05)))
        raw_events.append((on_tick, 0, channel, midi_note, vel))
        raw_events.append((off_tick, 1, channel, midi_note, 0))
    raw_events.sort(key=lambda item: (item[0], item[1]))

    try:
        mid = mido.MidiFile(ticks_per_beat=ticks_per_beat)
        track = mido.MidiTrack()
        mid.tracks.append(track)
        track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(max(bpm, 1.0)), time=0))
        last_tick = 0
        for tick, is_off, channel, note, velocity in raw_events:
            delta = max(0, tick - last_tick)
            last_tick = tick
            msg_type = "note_off" if is_off else "note_on"
            track.append(mido.Message(msg_type, note=note, velocity=velocity, channel=channel, time=delta))
        mid.save(str(path))
        return True
    except Exception:
        return False


# Her enstruman katmani icin dogrudan klavye kisayolu (el hareketine bagli
# kalmadan istendigi an ac/kapa). Harf secimleri mumkun oldugunca Turkce
# isimle eslesir (P=Piyano, B=Baglama, N=Ney, Y=Yaylilar, K=Keman, G=Gitar,
# Z=Davul); cakisan birkacinda (Bakir nefesli, Pad, Bas, Ritim/Bateri, Nefesli)
# rastgele ama sabit bir harf kullanilir - tam liste `/` ile acilan kilavuzda
# ve HUD'daki orkestra izgarasinin her hucresinde de gosterilir.
LAYER_KEYS: Dict[str, Tuple[str, str]] = {
    "p": ("PIANO", "Piyano"),
    "b": ("BAGLAMA", "Baglama"),
    "n": ("NEY", "Ney"),
    "w": ("WOODWINDS", "Nefesli"),
    "c": ("BRASS", "Bakir nefesli"),
    "y": ("STRINGS", "Yaylilar"),
    "k": ("KEMAN", "Keman"),
    "g": ("GITAR", "Gitar"),
    "j": ("PAD", "Pad"),
    "l": ("BASS", "Bas"),
    "i": ("DRUMS", "Ritim (bateri)"),
    "z": ("DAVUL", "Davul"),
}
LAYER_KEY_BY_NAME: Dict[str, str] = {layer: key for key, (layer, _label) in LAYER_KEYS.items()}
LAYER_LABEL_BY_NAME: Dict[str, str] = {layer: label for layer, label in LAYER_KEYS.values()}


class HarmoniApp:
    def __init__(
        self,
        camera_index: Optional[int] = CAMERA_INDEX,
        demo: bool = False,
        performance: str = "balanced",
        piano_volume: float = 0.30,
        theme_index: int = 0,
        monitor_enabled: bool = True,
        mirror: bool = True,
        low_latency: bool = False,
        resolution: Optional[str] = None,
        simple_mode: bool = True,
    ) -> None:
        self.camera_index = camera_index
        self.demo = demo
        self.performance = performance
        self.low_latency = low_latency
        self.resolution = resolution
        self.simple_mode = simple_mode
        self.state = RuntimeState()
        self.state.simple_mode = simple_mode
        self.audio = AudioEngine(self.state)
        self.audio.synth.music_gain = clamp(piano_volume, 0.08, 0.46)
        self.audio.dsp.monitor_enabled = monitor_enabled
        process_every = {"fast": 3, "balanced": 2, "quality": 1}.get(performance, 2)
        process_width = {"fast": 384, "balanced": 512, "quality": 640}.get(performance, 512)
        self.hand_tracker = HandTracker(process_width=process_width, process_every=process_every)
        self.gesture_controller = GestureController(self.state, self.audio)
        self.auto_arranger = AutoArranger(self.state, self.audio.synth)
        self.renderer = HUDRenderer(self.state, self.audio)
        self.renderer.cycle_theme(theme_index)
        self.camera: Optional[CameraWorker] = None
        self.running = True
        self.mirror = mirror
        self.recording = False
        self._recording_stamp = ""
        self.writer: Optional[cv2.VideoWriter] = None
        self.show_guide = False
        self.toast = ""
        self.toast_until = 0.0
        self.demo_phase = 0.0
        self.last_frame: Optional[np.ndarray] = None
        self.last_camera_frame_id = -1
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    def init_camera(self) -> bool:
        if self.demo:
            return False
        if self.resolution and self.resolution in RESOLUTION_PRESETS:
            width, height = RESOLUTION_PRESETS[self.resolution]
        else:
            width, height = {
                "fast": (640, 360),
                "balanced": (CAM_CAPTURE_WIDTH, CAM_CAPTURE_HEIGHT),
                "quality": (CAM_WIDTH, CAM_HEIGHT),
            }.get(self.performance, (CAM_CAPTURE_WIDTH, CAM_CAPTURE_HEIGHT))
        # camera_index None ise ("auto"), veya belirtilen index acilamazsa,
        # calisan ilk kamerayi bulana kadar sirayla diger indeksler denenir;
        # boylece yanlis/degismis bir kamera indeksi uygulamayi tikamaz.
        if self.camera_index is not None:
            candidates = [self.camera_index] + [i for i in range(5) if i != self.camera_index]
        else:
            candidates = list(range(5))
        last_error = ""
        for index in candidates:
            camera = CameraWorker(index, width, height, CAM_FPS, self.state)
            camera.start()
            # Bazi Windows surucu/kamera kombinasyonlarinda backend enumerasyonu
            # (ozellikle DSHOW) birkac saniye surebilir; erken vazgecmek
            # calisan bir kamerayi "bulunamadi" olarak isaretleyebilir.
            camera.opened.wait(timeout=6.0)
            if camera.cap is not None:
                self.camera = camera
                self.camera_index = index
                if index != candidates[0]:
                    print(f"[BILGI] Kamera index {candidates[0]} acilamadi, index {index} kullaniliyor.")
                return True
            last_error = camera.last_error or last_error
            camera.stop()
        if last_error:
            print(f"[UYARI] Kamera bulunamadi: {last_error}")
        return False

    def set_toast(self, message: str, duration: float = 1.8) -> None:
        self.toast = message
        self.toast_until = time.time() + duration

    def _fallback_frame(self) -> np.ndarray:
        h, w = CAM_HEIGHT, CAM_WIDTH
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        theme = self.renderer.theme
        frame[:] = theme.bg
        self.demo_phase += 0.035
        draw_text(frame, "Kamera bekleniyor", 500, 320, 0.66, theme.text, 1)
        draw_text(frame, "1) Baska bir uygulama (Teams/Zoom/OBS) kamerayi kullaniyor olabilir, kapatip dene", 320, 360, 0.32, theme.muted, 1)
        draw_text(frame, "2) --camera auto ile kamerayi otomatik bul", 320, 386, 0.32, theme.muted, 1)
        draw_text(frame, "3) Windows Ayarlar > Gizlilik > Kamera > 'Uygulamalarin erisimine izin ver' acik mi?", 320, 412, 0.32, theme.muted, 1)
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

    def _finish_wav_capture(self, stamp: str) -> bool:
        frames = self.audio.stop_wav_capture()
        if frames is None or len(frames) == 0:
            return False
        path = OUTPUT_DIR / f"harmoni_{stamp}.wav"
        try:
            pcm = np.clip(frames, -1.0, 1.0)
            pcm16 = (pcm * 32767.0).astype(np.int16)
            with wave.open(str(path), "wb") as handle:
                handle.setnchannels(2)
                handle.setsampwidth(2)
                handle.setframerate(AUDIO_SR)
                handle.writeframes(pcm16.tobytes())
            return True
        except Exception:
            return False

    def _finish_midi_capture(self, stamp: str) -> bool:
        events = self.audio.synth.stop_midi_capture()
        if not events:
            return False
        with self.state.lock:
            bpm = self.state.music.bpm
        path = OUTPUT_DIR / f"harmoni_{stamp}.mid"
        return export_midi(path, events, bpm)

    def _toggle_recording(self, frame: np.ndarray) -> None:
        if self.recording:
            self.recording = False
            if self.writer is not None:
                self.writer.release()
            self.writer = None
            stamp = self._recording_stamp
            saved = ["video"]
            if self._finish_wav_capture(stamp):
                saved.append("ses")
            if self._finish_midi_capture(stamp):
                saved.append("MIDI")
            else:
                if not MIDO_AVAILABLE:
                    saved.append("MIDI yok: pip install mido")
            self.set_toast(f"Kayit tamamlandi ({', '.join(saved)})")
            return
        h, w = frame.shape[:2]
        stamp = time.strftime("%Y%m%d_%H%M%S")
        self._recording_stamp = stamp
        path = OUTPUT_DIR / f"harmoni_{stamp}.mp4"
        self.writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (w, h))
        if not self.writer.isOpened():
            self.writer = None
            self.set_toast("Video kaydi acilamadi")
            return
        self.recording = True
        self.audio.start_wav_capture()
        self.audio.synth.start_midi_capture()
        self.set_toast(f"Kayit basladi: {path.name}")

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
        elif key in (ord("t"), ord("T")):
            system = self.audio.harmony.toggle_tonal_system()
            label = "Turk Makam" if system == "makam" else "Bati (Major/Minor)"
            self.set_toast(f"Tonalite sistemi: {label}")
        elif key in (ord("a"), ord("A")):
            enabled = self.auto_arranger.toggle()
            self.set_toast(f"Otomatik duzenleme {'acik' if enabled else 'kapali (manuel kontrol)'}")
        elif key in (ord("d"), ord("D")):
            choice = self.audio.harmony.cycle_mode_color()
            label = "Otomatik (major/minor tespiti)" if choice == "auto" else choice.title()
            self.set_toast(f"Dizi rengi: {label}")
        elif key in (ord("/"), ord("?")):
            self.show_guide = not self.show_guide
            with self.state.lock:
                self.state.show_guide = self.show_guide
        elif key == 9:  # Tab
            self.simple_mode = not self.simple_mode
            with self.state.lock:
                self.state.simple_mode = self.simple_mode
            self.set_toast("Gelismis gorunum" if not self.simple_mode else "Basit gorunum")
        elif 0 <= key < 256 and chr(key).lower() in LAYER_KEYS:
            layer, label = LAYER_KEYS[chr(key).lower()]
            active = self.audio.synth.toggle_layer(layer)
            self.set_toast(f"{label} {'acik' if active else 'kapali'}")
        elif ord("1") <= key <= ord("4"):
            self.renderer.cycle_theme(key - ord("1"))

    def run(self) -> None:
        camera_ok = self.init_camera()
        audio_ok = self.audio.start(low_latency=self.low_latency)
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
                self.auto_arranger.update()
                self.audio.restart_if_unhealthy()
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

    def build_config_dict(self) -> Dict[str, object]:
        return {
            "theme_index": self.renderer.theme_index,
            "piano_volume": self.audio.synth.music_gain,
            "performance": self.performance,
            "camera_index": self.camera_index if self.camera_index is not None else CAMERA_INDEX,
            "monitor_enabled": self.audio.dsp.monitor_enabled,
            "mirror": self.mirror,
            "resolution": self.resolution or "",
            "simple_mode": self.simple_mode,
        }

    def cleanup(self) -> None:
        save_config(self.build_config_dict())
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
    total_steps = 25
    print(f"[1/{total_steps}] Pitch detector test")
    state = RuntimeState()
    tracker = PitchTracker(state)
    t = np.arange(4096, dtype=np.float64) / AUDIO_SR
    sine = (0.16 * np.sin(2.0 * math.pi * 220.0 * t)).astype(np.float32)
    pitch = tracker.detect(sine)
    if not pitch.voiced or abs(pitch.frequency - 220.0) > 6.0:
        raise RuntimeError(f"Pitch test failed: {pitch}")

    print(f"[2/{total_steps}] Vocal DSP test")
    dsp = VocalDSP()
    processed = dsp.process(sine[:AUDIO_BLOCK])
    if processed.shape != (AUDIO_BLOCK, 2) or not np.isfinite(processed).all():
        raise RuntimeError("Vocal DSP produced invalid output")

    print(f"[3/{total_steps}] Harmony engine test")
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

    print(f"[4/{total_steps}] Synth render test")
    synth = SynthEngine(state)
    synth.full_orchestra()
    rendered = synth.render(AUDIO_BLOCK)
    if rendered.shape != (AUDIO_BLOCK, 2) or not np.isfinite(rendered).all():
        raise RuntimeError("Synth produced invalid output")

    print(f"[5/{total_steps}] Vocal ducking test")
    duck_state = RuntimeState()
    with duck_state.lock:
        duck_state.music.chord_notes = (45, 48, 52)
        duck_state.music.phrase_active = True
        duck_state.vocal_level = 0.05
    duck_synth = SynthEngine(duck_state)
    active_mix = duck_synth.render(AUDIO_BLOCK)
    if not np.isfinite(active_mix).all() or duck_synth.music_gain > 0.46:
        raise RuntimeError("Ducking test failed")

    print(f"[6/{total_steps}] Synth ifade kontrolleri (parlaklik/artikulasyon) testi")
    expr_state = RuntimeState()
    expr_synth = SynthEngine(expr_state)
    expr_synth.full_orchestra()
    expr_synth.set_brightness(0.1)
    expr_synth.set_articulation(0.0)
    dark = expr_synth.render(AUDIO_BLOCK)
    expr_synth.set_brightness(1.0)
    expr_synth.set_articulation(1.0)
    bright = expr_synth.render(AUDIO_BLOCK)
    if not np.isfinite(dark).all() or not np.isfinite(bright).all():
        raise RuntimeError("Parlaklik/artikulasyon kontrolleri gecersiz sinyal uretti")

    print(f"[7/{total_steps}] Opsiyonel FluidSynth katmani (yoksayma) testi")
    missing_backend = FluidSynthBackend("olmayan_dosya.sf2", AUDIO_SR)
    if missing_backend.available:
        raise RuntimeError("FluidSynthBackend olmayan dosyayla 'available' donmemeli")
    silent = missing_backend.render(AUDIO_BLOCK)
    if silent.shape != (AUDIO_BLOCK, 2) or not np.isfinite(silent).all():
        raise RuntimeError("FluidSynthBackend fallback render gecersiz")

    print(f"[8/{total_steps}] Jest ifade (surekli kontrol) testi")
    gesture_state = RuntimeState()
    gesture_audio = AudioEngine(gesture_state)
    controller = GestureController(gesture_state, gesture_audio)
    for cx in (100, 260):
        fake_hand = HandPacket(
            label="RIGHT", landmarks=[(0, 0)] * 21, normalized=[(0.0, 0.0, 0.0)] * 21,
            gesture="NEUTRAL", confidence=0.9, openness=1.1, pinch=0.6,
            fingers=(True, True, True, True, True), palm_center=(cx, 100), hand_size=120.0,
        )
        controller.update([fake_hand])
    if not (0.0 <= gesture_audio.synth.brightness <= 1.0):
        raise RuntimeError("Parlaklik kontrolu araligin disinda")
    if not (0.0 <= gesture_audio.synth.articulation <= 1.0):
        raise RuntimeError("Artikulasyon kontrolu araligin disinda")

    print(f"[9/{total_steps}] Ayar kalicilik (config) testi")
    test_config_path = CONFIG_PATH.with_name("harmoni_config.selftest.json")
    try:
        cfg = dict(DEFAULT_CONFIG)
        cfg["theme_index"] = 3
        cfg["piano_volume"] = 0.31
        save_config(cfg, path=test_config_path)
        reloaded = load_config(path=test_config_path)
        if reloaded["theme_index"] != 3 or abs(float(reloaded["piano_volume"]) - 0.31) > 1e-9:
            raise RuntimeError("Config round-trip basarisiz")
    finally:
        if test_config_path.exists():
            test_config_path.unlink()

    print(f"[10/{total_steps}] MIDI disa aktarim testi")
    if MIDO_AVAILABLE:
        midi_state = RuntimeState()
        midi_synth = SynthEngine(midi_state)
        midi_synth.full_orchestra()
        midi_synth.start_midi_capture()
        for _ in range(40):
            midi_synth.render(AUDIO_BLOCK)
        events = midi_synth.stop_midi_capture()
        if not events:
            raise RuntimeError("MIDI olay kaydi bos")
        midi_path = Path(__file__).with_name("harmoni_selftest.mid")
        try:
            if not export_midi(midi_path, events, 90.0):
                raise RuntimeError("export_midi basarisiz oldu")
            exported = mido.MidiFile(str(midi_path))
            note_ons = sum(1 for msg in exported.tracks[0] if msg.type == "note_on")
            if note_ons == 0:
                raise RuntimeError("Yazilan MIDI dosyasinda note_on bulunamadi")
        finally:
            if midi_path.exists():
                midi_path.unlink()
    else:
        print("    mido kurulu degil, MIDI export testi atlandi (pip install mido)")

    print(f"[11/{total_steps}] WAV kayit testi")
    wav_state = RuntimeState()
    wav_audio = AudioEngine(wav_state)
    wav_audio.start_wav_capture()
    for _ in range(20):
        block = np.random.uniform(-0.2, 0.2, size=(AUDIO_BLOCK, 2)).astype(np.float32)
        wav_audio._wav_frames.append(block)
    wav_frames = wav_audio.stop_wav_capture()
    if wav_frames is None or wav_frames.shape[0] != 20 * AUDIO_BLOCK:
        raise RuntimeError("WAV kayit tamponu beklenen uzunlukta degil")
    wav_path = Path(__file__).with_name("harmoni_selftest.wav")
    try:
        pcm16 = (np.clip(wav_frames, -1.0, 1.0) * 32767.0).astype(np.int16)
        with wave.open(str(wav_path), "wb") as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(AUDIO_SR)
            handle.writeframes(pcm16.tobytes())
        with wave.open(str(wav_path), "rb") as handle:
            if handle.getnchannels() != 2 or handle.getnframes() != 20 * AUDIO_BLOCK:
                raise RuntimeError("Yazilan WAV dosyasi beklenen formatta degil")
    finally:
        if wav_path.exists():
            wav_path.unlink()

    print(f"[12/{total_steps}] Makam olcek butunlugu testi")
    for makam_name, intervals in MAKAM_SCALES_KOMA.items():
        if sum(intervals) != 53:
            raise RuntimeError(f"{makam_name} araliklari 53 komaya tamamlanmiyor: {sum(intervals)}")
        degrees = makam_scale_degrees_komas(makam_name)
        if len(degrees) != 7 or degrees[0] != 0 or len(set(degrees)) != 7:
            raise RuntimeError(f"{makam_name} perde konumlari gecersiz: {degrees}")

    print(f"[13/{total_steps}] Makam algilama testi")
    makam_state = RuntimeState()
    with makam_state.lock:
        makam_state.music.tonal_system = "makam"
    makam_harmony = HarmonyEngine(makam_state)
    tonic_midi = 62.0
    hicaz_notes = [tonic_midi + komas_to_semitones(o) for o in makam_scale_degrees_komas("HICAZ")]
    phrase = hicaz_notes + [hicaz_notes[4], hicaz_notes[2], hicaz_notes[0], hicaz_notes[0]]
    base_now = time.monotonic()
    for rep in range(10):
        for offset, m in enumerate(phrase):
            fake_time = base_now + (rep * len(phrase) + offset) * 0.12
            makam_harmony.update(PitchSnapshot(
                frequency=midi_to_frequency(m), midi_note=int(round(m)), confidence=0.9, rms=0.08,
                voiced=True, timestamp=fake_time,
            ))
            makam_harmony.last_key_update = fake_time - 0.6
            makam_harmony.last_chord_change = fake_time - 1.0
            makam_harmony.started = fake_time - 1.0
    with makam_state.lock:
        if not makam_state.music.makam_degrees:
            raise RuntimeError("Makam motoru perde uretmedi")

    print(f"[14/{total_steps}] Baglama (Karplus-Strong) sentez testi")
    baglama_state = RuntimeState()
    baglama_synth = SynthEngine(baglama_state)
    baglama_synth.trigger(62.3, "baglama", velocity=0.6, duration=0.3, pan=0.0)
    baglama_out = baglama_synth.render(AUDIO_BLOCK)
    if baglama_out.shape != (AUDIO_BLOCK, 2) or not np.isfinite(baglama_out).all():
        raise RuntimeError("Baglama sentezi gecersiz sinyal uretti")

    print(f"[15/{total_steps}] Perde adi testi")
    rast_name, rast_offset = nearest_perde_name(midi_to_frequency(PERDE_REFERENCE_MIDI))
    if rast_name != "Rast" or abs(rast_offset) > 5.0:
        raise RuntimeError(f"Rast referansi yanlis cozumlendi: {rast_name} {rast_offset:+0.1f}c")
    dugah_name, dugah_offset = nearest_perde_name(midi_to_frequency(PERDE_REFERENCE_MIDI + komas_to_semitones(9)))
    if dugah_name != "Dugah" or abs(dugah_offset) > 5.0:
        raise RuntimeError(f"Dugah referansi yanlis cozumlendi: {dugah_name} {dugah_offset:+0.1f}c")

    print(f"[16/{total_steps}] Yeni orkestra sesleri (nefesli/bakir/ney) testi")
    winds_state = RuntimeState()
    winds_synth = SynthEngine(winds_state)
    for kind, note in (("flute", 69.0), ("brass", 57.0), ("ney", 64.3)):
        winds_synth.trigger(note, kind, velocity=0.5, duration=0.3, pan=0.0)
    winds_out = []
    for _ in range(15):
        winds_out.append(winds_synth.render(AUDIO_BLOCK))
    winds_arr = np.concatenate(winds_out, axis=0)
    if not np.isfinite(winds_arr).all():
        raise RuntimeError("Yeni orkestra sesleri gecersiz sinyal uretti")

    print(f"[17/{total_steps}] Katman sayisi kazanc telafisi testi")

    def _measure_rms(layers: Set[str]) -> float:
        gain_state = RuntimeState()
        gain_synth = SynthEngine(gain_state)
        gain_synth.set_layers(layers)
        blocks = [gain_synth.render(AUDIO_BLOCK) for _ in range(80)]
        return float(np.sqrt(np.mean(np.concatenate(blocks, axis=0) ** 2)))

    rms_five = _measure_rms({"PIANO", "STRINGS", "BASS", "DRUMS", "PAD"})
    rms_nine = _measure_rms({"PIANO", "STRINGS", "BASS", "DRUMS", "PAD", "BAGLAMA", "WOODWINDS", "BRASS", "NEY"})
    if rms_five <= 0.0:
        raise RuntimeError("Referans katman seviyesi olcuulemedi")
    ratio = rms_nine / rms_five
    if not (0.7 <= ratio <= 1.3):
        raise RuntimeError(f"9 katman / 5 katman ses orani beklenen araligin disinda: {ratio:0.2f}")

    print(f"[18/{total_steps}] Otomatik duzenleme (AutoArranger) testi")
    arrange_state = RuntimeState()
    arrange_synth = SynthEngine(arrange_state)
    arranger = AutoArranger(arrange_state, arrange_synth)
    with arrange_state.lock:
        arrange_state.music.tonal_system = "makam"
        arrange_state.music.bpm = 72.0
        arrange_state.music.rhythm_feel = "duz"
    arranger.last_applied = 0.0
    arranger.update()
    with arrange_state.lock:
        alaturka_layers = set(arrange_state.active_layers)
    if not {"BAGLAMA", "NEY", "PAD"}.issubset(alaturka_layers) or "DRUMS" in alaturka_layers:
        raise RuntimeError(f"Alaturka senaryosunda beklenen katman seti gelmedi: {alaturka_layers}")
    enabled_after_toggle = arranger.toggle()
    if enabled_after_toggle:
        raise RuntimeError("AutoArranger.toggle() kapatmadi")

    print(f"[19/{total_steps}] Dizi rengi (mode color) testi")
    mode_state = RuntimeState()
    mode_harmony = HarmonyEngine(mode_state)
    with mode_state.lock:
        mode_state.music.key_root = 2  # D
    expected_sequence = ["major", "minor", "dorian", "mixolydian", "auto"]
    actual_sequence = [mode_harmony.cycle_mode_color() for _ in expected_sequence]
    if actual_sequence != expected_sequence:
        raise RuntimeError(f"Dizi rengi dongusu beklenmedik sirada: {actual_sequence}")
    dorian_triads = mode_harmony._diatonic_triads(2, "dorian")
    dorian_names = [name for name, _notes, _root, _degree in dorian_triads]
    if dorian_names[:4] != ["Dm", "Em", "F", "G"]:
        raise RuntimeError(f"D Dorian akorlari yanlis: {dorian_names}")

    print(f"[20/{total_steps}] Yeni enstruman ve klavye kisayolu testi")
    extra_state = RuntimeState()
    extra_synth = SynthEngine(extra_state)
    for kind, note in (("guitar", 57.0), ("keman", 69.0), ("davul", 40.0), ("davul", 64.0)):
        extra_synth.trigger(note, kind, velocity=0.5, duration=0.3, pan=0.0)
    extra_out = [extra_synth.render(AUDIO_BLOCK) for _ in range(15)]
    if not np.isfinite(np.concatenate(extra_out, axis=0)).all():
        raise RuntimeError("Gitar/keman/davul gecersiz sinyal uretti")
    expected_layers = {
        "PIANO", "BAGLAMA", "NEY", "WOODWINDS", "BRASS", "STRINGS",
        "KEMAN", "GITAR", "PAD", "BASS", "DRUMS", "DAVUL",
    }
    mapped_layers = {layer for layer, _label in LAYER_KEYS.values()}
    if mapped_layers != expected_layers:
        raise RuntimeError(f"LAYER_KEYS beklenen 12 katmani tam kapsamiyor: {mapped_layers}")
    if len(LAYER_KEYS) != len(expected_layers):
        raise RuntimeError("LAYER_KEYS icinde tekrar eden veya eksik tus var")

    print(f"[21/{total_steps}] Orkestra oda reverb'i testi")
    reverb_state = RuntimeState()
    with reverb_state.lock:
        reverb_state.music.chord_notes = ()  # otomatik zamanlayiciyi etkisiz birak
    reverb_synth = SynthEngine(reverb_state)
    reverb_synth.trigger(60.0, "strings", velocity=0.8, duration=0.3, pan=0.0)
    reverb_blocks = [reverb_synth.render(AUDIO_BLOCK) for _ in range(120)]
    reverb_all = np.concatenate(reverb_blocks, axis=0)
    if not np.isfinite(reverb_all).all():
        raise RuntimeError("Orkestra reverb'i gecersiz sinyal uretti")
    early_rms = float(np.sqrt(np.mean(np.concatenate(reverb_blocks[2:6], axis=0) ** 2)))
    late_rms = float(np.sqrt(np.mean(np.concatenate(reverb_blocks[-6:], axis=0) ** 2)))
    if late_rms >= early_rms:
        raise RuntimeError(f"Reverb kuyrugu sonmuyor: erken={early_rms:.5f} gec={late_rms:.5f}")

    print(f"[22/{total_steps}] Dusuk gecikme (WASAPI) baslatma testi")
    latency_state = RuntimeState()
    latency_audio = AudioEngine(latency_state)
    latency_ok = latency_audio.start(low_latency=True)
    latency_audio.stop()
    if SOUNDDEVICE_AVAILABLE and not latency_ok:
        raise RuntimeError("--low-latency ile baslatma basarisiz oldu (donanimsiz ortamda dahi normal moda dusmeli)")

    print(f"[23/{total_steps}] Kamera backend yedekleme testi")
    dummy_state = RuntimeState()
    dummy_camera = CameraWorker(9999, 320, 240, 15, dummy_state)
    backends = dummy_camera._candidate_backends()
    if not backends:
        raise RuntimeError("Kamera backend listesi bos")
    if dummy_camera._open():
        raise RuntimeError("Var olmayan kamera indeksi basariyla acilmamali")
    if not dummy_camera.last_error:
        raise RuntimeError("Basarisiz kamera acilisi bir hata mesaji birakmali")

    print(f"[24/{total_steps}] Renderer performance test")
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

    print(f"[25/{total_steps}] HUD preview")
    preview = Path(__file__).with_name("harmoni_preview.png")
    create_preview(preview)
    print(f"Self test passed. Preview: {preview}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HARMONI")
    parser.add_argument("--camera", type=str, default=None, help="OpenCV camera index veya 'auto' (belirtilmezse son oturumdaki index kullanilir)")
    parser.add_argument("--demo", action="store_true", help="Kamera olmadan gorsel demo arka plani")
    parser.add_argument("--self-test", action="store_true", help="Donanim acmadan cekirdek testleri calistir")
    parser.add_argument("--performance", choices=("fast", "balanced", "quality"), default=None, help="Kamera/el takip performans profili (belirtilmezse son oturumdaki profil kullanilir)")
    parser.add_argument("--piano-volume", type=float, default=None, help="Piyano ana seviyesi, 0.08-0.46 (belirtilmezse son oturumdaki seviye kullanilir)")
    parser.add_argument("--no-monitor", action="store_true", help="Canli vokal monitoring kapali baslat")
    parser.add_argument("--soundfont", type=str, default=None, help="Opsiyonel .sf2 soundfont dosya yolu (pyfluidsynth gerektirir)")
    parser.add_argument("--reset-config", action="store_true", help="Kaydedilmis ayarlari yok sayip varsayilanlarla baslat")
    parser.add_argument("--low-latency", action="store_true", help="Windows'ta WASAPI exclusive modu dene (daha dusuk ses gecikmesi; aygit baskasi tarafindan kullaniliyorsa otomatik olarak normal moda duser)")
    parser.add_argument("--resolution", choices=tuple(RESOLUTION_PRESETS.keys()), default=None, help="Kameradan istenecek yakalama cozunurlugu (varsayilan: --performance profiline gore). HUD her zaman 1280x720 tasarim cozunurlugunde bilesimlenir; daha yuksek deger el takibi/goruntu netligi icin daha detayli bir kaynak saglar ama pencere boyutunu degistirmez.")
    parser.add_argument("--ui-mode", choices=("simple", "advanced"), default=None, help="Baslangic arayuz modu: simple (kamera + buyuk nota/eslik gostergesi, varsayilan) veya advanced (tam gosterge paneli). Calisirken Tab ile ikisi arasinda gecilebilir.")
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

    config = dict(DEFAULT_CONFIG) if args.reset_config else load_config()
    if args.camera is not None:
        camera_index = None if args.camera.strip().lower() == "auto" else int(args.camera)
    else:
        camera_index = int(config.get("camera_index", CAMERA_INDEX))
    performance = args.performance if args.performance is not None else str(config.get("performance", "balanced"))
    piano_volume = args.piano_volume if args.piano_volume is not None else float(config.get("piano_volume", 0.30))
    theme_index = int(config.get("theme_index", 0))
    monitor_enabled = bool(config.get("monitor_enabled", True)) and not args.no_monitor
    mirror = bool(config.get("mirror", True))
    resolution = args.resolution if args.resolution is not None else (str(config.get("resolution", "")) or None)
    if args.ui_mode is not None:
        simple_mode = args.ui_mode == "simple"
    else:
        simple_mode = bool(config.get("simple_mode", True))

    app = HarmoniApp(
        camera_index=camera_index,
        demo=args.demo,
        performance=performance,
        piano_volume=piano_volume,
        theme_index=theme_index,
        monitor_enabled=monitor_enabled,
        mirror=mirror,
        low_latency=args.low_latency,
        resolution=resolution,
        simple_mode=simple_mode,
    )
    if args.soundfont:
        backend = FluidSynthBackend(args.soundfont, AUDIO_SR)
        if backend.available:
            app.audio.synth.attach_fluidsynth(backend)
            print(f"[BILGI] Soundfont yuklendi: {args.soundfont}")
        else:
            print(f"[UYARI] Soundfont etkinlestirilemedi: {backend.error}")
            print("Procedural sentezleyici ile devam ediliyor.")
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
