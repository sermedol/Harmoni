@echo off
cd /d %~dp0
python -m pip install pyinstaller
python -m PyInstaller harmoni.spec --noconfirm
echo.
echo Derleme tamamlandi. Calistirilabilir dosya: dist\Harmoni\Harmoni.exe
pause
