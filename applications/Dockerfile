# From the repository root: docker build -f applications/Dockerfile -t ace-applications:local .
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 nodejs ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --chmod=0644 applications/vendor/decimal.js /opt/ace/vendor/node_modules/decimal.js/index.js
COPY --chmod=0644 applications/vendor/DECIMAL-LICENSE.md /opt/ace/vendor/node_modules/decimal.js/LICENSE.md
RUN chmod 0755 /opt/ace && chmod -R a+rX /opt/ace/vendor && mkdir -p /workspace && chown 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000
CMD ["python3", "-c", "import time;time.sleep(300)"]
