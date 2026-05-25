FROM cgr.dev/chainguard/wolfi-base:latest

RUN apk add --no-cache \
    bash \
    ca-certificates \
    coreutils \
    curl \
    ffmpeg \
    font-noto \
    font-noto-cjk \
    fontconfig \
    ghostscript \
    libsndfile \
    mediainfo \
    poppler-utils \
    py3-pip \
    py3-virtualenv \
    python-3.13 \
    qpdf \
    tesseract \
    tesseract-eng \
    unzip \
    wget \
    && printf '%s\n' \
    'torch==2.10.0+cpu' \
    'torchvision==0.25.0+cpu' \
    > /tmp/torch-cpu-constraints.txt \
    && pip3 install --no-cache-dir --break-system-packages \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -c /tmp/torch-cpu-constraints.txt \
    torch==2.10.0+cpu \
    torchvision==0.25.0+cpu \
    && pip3 install --no-cache-dir --break-system-packages \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -c /tmp/torch-cpu-constraints.txt \
    beautifulsoup4 \
    docling \
    numpy \
    openpyxl \
    pandas \
    pillow \
    python-dotenv \
    requests \
    && python3 -c "import docling, torch, torchvision; assert torch.version.cuda is None, torch.version.cuda; assert not torch.cuda.is_available()" \
    && python3 -c "import importlib.metadata as m; bad = sorted(d.metadata.get('Name', '').lower() for d in m.distributions() if d.metadata.get('Name', '').lower().startswith(('nvidia-', 'cuda-', 'triton'))); assert not bad, bad" \
    && tesseract --version \
    && pdftotext -v \
    && qpdf --version \
    && ffmpeg -version \
    && ffprobe -version \
    && mediainfo --Version \
    && rm -f /tmp/torch-cpu-constraints.txt \
    && addgroup -g 1000 agent \
    && adduser -D -h /home/agent -s /bin/bash -u 1000 -G agent agent \
    && mkdir -p /workspace \
    && chown -R agent:agent /home/agent /workspace

USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]
