@echo off
cd /d "%~dp0ml-service"
if not exist venv (
  echo Creating virtual environment...
  python -m venv venv
)
call venv\Scripts\activate.bat
echo Installing requirements...
pip install -r requirements.txt

REM Load the Supabase env vars from the root .env
for /f "tokens=*" %%a in ('findstr /v "^#" ..\.env') do set %%a

echo Starting ML Service...
python -m uvicorn main:app --port 8001 --reload
