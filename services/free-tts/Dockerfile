FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    MODEL_PATH=/models/kokoro-v1.0.onnx \
    VOICES_PATH=/models/voices-v1.0.bin \
    HOST=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl espeak-ng libespeak-ng1 libsndfile1 libgomp1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/kokoro
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

RUN mkdir -p /models && \
    curl --fail --location --retry 3 --output /models/kokoro-v1.0.onnx \
      https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && \
    curl --fail --location --retry 3 --output /models/voices-v1.0.bin \
      https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin && \
    echo "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5  /models/kokoro-v1.0.onnx" | sha256sum -c - && \
    echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /models/voices-v1.0.bin" | sha256sum -c -

COPY server.py ./server.py
RUN useradd --system --uid 10002 --home-dir /nonexistent --shell /usr/sbin/nologin kokoro && \
    chown -R kokoro:kokoro /opt/kokoro /models
USER kokoro

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=90s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()" || exit 1
CMD ["python", "server.py"]
