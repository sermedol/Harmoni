# -*- mode: python ; coding: utf-8 -*-
# PyInstaller ile tek makine icin bagimsiz calistirilabilir derleme.
# Kullanim: python -m PyInstaller harmoni.spec --noconfirm
# (once "python -m pip install pyinstaller" ile kurulmali)
#
# MediaPipe buyuk ikili model dosyalari icerdiginden derleme birkac dakika
# surebilir ve cikti boyutu buyuk olabilir (yuzlerce MB). Bu spec en yaygin
# gizli baglantilari (hidden imports) ve veri dosyalarini toplamaya calisir;
# hedef makinede farkli bir MediaPipe/OpenCV surumu varsa kucuk ayarlamalar
# gerekebilir.

from PyInstaller.utils.hooks import collect_data_files

# NOT: collect_submodules("mediapipe") kasten kullanilmiyor; mediapipe'in
# model_maker/egitim alt modulleri torch, tensorflow, matplotlib gibi devasa
# ve bu uygulamada hic kullanilmayan bagimliliklari da beraberinde surukleyip
# cikti boyutunu (~400MB yerine ~1GB+) sismektedir. harmoni.py yalnizca
# mediapipe.solutions.hands kullandigi icin PyInstaller'in normal statik
# analiz taramasi bu import'u zaten dogru sekilde yakalar.
datas = collect_data_files("mediapipe")

a = Analysis(
    ["harmoni.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Harmoni",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    icon=None,
)
