FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODEL_PATH=/opt/kokoro-models/kokoro.onnx \
    VOICES_PATH=/opt/kokoro-models/voices.bin \
    KOKORO_BIND_HOST=0.0.0.0 \
    KOKORO_PORT=8080 \
    KOKORO_CPU_THREADS=2

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates curl libgomp1 libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

COPY workers/free-tts/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/kokoro-venv && \
    /opt/kokoro-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt && \
    mkdir -p /opt/kokoro-models && \
    curl -fL --retry 3 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx -o /opt/kokoro-models/kokoro.onnx && \
    curl -fL --retry 3 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin -o /opt/kokoro-models/voices.bin && \
    echo "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb  /opt/kokoro-models/kokoro.onnx" | sha256sum -c - && \
    echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /opt/kokoro-models/voices.bin" | sha256sum -c -

RUN useradd --system --uid 10001 --create-home kokoro && \
    chown -R 10001:10001 /opt/kokoro-models /opt/kokoro-venv
COPY workers/free-tts/server.py /app/server.py
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=4s --start-period=90s --retries=3 CMD ["/opt/kokoro-venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"]
CMD ["/opt/kokoro-venv/bin/python", "/app/server.py"]
