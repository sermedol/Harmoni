@echo off
cd /d %~dp0
python -m pip install -r requirements.txt
python harmoni.py --performance balanced
pause
