FROM cgr.dev/chainguard/wolfi-base:latest

RUN apk add --no-cache \
    bash \
    ca-certificates \
    coreutils \
    curl \
    font-noto \
    font-noto-cjk \
    fontconfig \
    ghostscript \
    poppler-utils \
    py3-pip \
    py3-virtualenv \
    python-3.13 \
    qpdf \
    tesseract \
    tesseract-eng \
    unzip \
    wget \
    && pip3 install --no-cache-dir --break-system-packages \
    beautifulsoup4 \
    docling \
    numpy \
    openpyxl \
    pandas \
    pillow \
    python-dotenv \
    requests \
    && addgroup -g 1000 agent \
    && adduser -D -h /home/agent -s /bin/bash -u 1000 -G agent agent \
    && mkdir -p /workspace \
    && chown -R agent:agent /home/agent /workspace

USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]
