FROM python:3.12-slim
WORKDIR /app
COPY bootstrap.py openai_runner.py package-lock.json server.py /app/
COPY Athena_Stella_Agent_Package_v3.zip /tmp/agent-package.zip
RUN python /app/bootstrap.py /tmp/agent-package.zip --root /opt/agents && rm /tmp/agent-package.zip
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENAI_CHAT_MODEL=gpt-4.1-mini
USER nobody
CMD ["python", "/app/server.py"]
