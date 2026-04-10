#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "========================================"
echo "  Bionic PDF Reader"
echo "========================================"
echo

# Check Python
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo "[ERROR] Python not found. Please install Python 3.8+ first."
    echo "        brew install python3"
    exit 1
fi

echo "[INFO] Using $($PY --version)"

# Create venv if not exists
if [ ! -d "venv" ]; then
    echo "[INFO] Creating virtual environment..."
    $PY -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install dependencies
echo "[INFO] Checking dependencies..."
pip install -r requirements.txt -q

# Create uploads folder
mkdir -p uploads

echo
echo "[INFO] Starting server at http://127.0.0.1:5000"
echo "[INFO] Press Ctrl+C to stop."
echo

# Open browser (macOS: open, Linux: xdg-open)
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://127.0.0.1:5000 &
elif command -v xdg-open &>/dev/null; then
    xdg-open http://127.0.0.1:5000 &
fi

python app.py
