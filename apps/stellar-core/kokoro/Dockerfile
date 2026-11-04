FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    MODEL_PATH=/models/kokoro.onnx \
    VOICES_PATH=/models/voices.bin \
    KOKORO_HOST=0.0.0.0 \
    KOKORO_PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 libsndfile1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/stellar-core/kokoro/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir --disable-pip-version-check -r /tmp/requirements.txt

RUN mkdir -p /models && \
    curl -fL --retry 3 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx -o /models/kokoro.onnx && \
    curl -fL --retry 3 https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin -o /models/voices.bin && \
    echo "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb  /models/kokoro.onnx" | sha256sum -c - && \
    echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /models/voices.bin" | sha256sum -c -

COPY apps/stellar-core/kokoro/server.py /app/server.py
RUN useradd --system --uid 10001 --home-dir /app kokoro && chown -R kokoro:kokoro /models /app
USER 10001:10001

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD python -c "import json,urllib.request; r=json.load(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3)); assert r.get('ready') is True"
CMD ["python", "/app/server.py"]
