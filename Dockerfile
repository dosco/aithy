FROM cgr.dev/chainguard/wolfi-base:latest

RUN apk add --no-cache \
    poppler-utils \
    ghostscript \
    qpdf \
    tesseract \
    tesseract-eng \
    fontconfig \
    font-noto \
    python-3.12 \
    py3-pip \
    && pip3 install --no-cache-dir --break-system-packages docling \
    && apk del py3-pip

USER nonroot
WORKDIR /app

CMD ["sh", "-c", "echo 'Secure Docling + classics ready' && docling --help | head -4"]
