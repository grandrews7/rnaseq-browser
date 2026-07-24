# ─────────────────────────────────────────────────────────────────────────────
# variant-scorer-pt
#
# PyTorch ChromBPNet variant scorer — no TensorFlow dependency.
# Built on CUDA 12.4 / cuDNN 9 — forward-compatible with CUDA 13.x drivers.
#
# Build:
#   docker build -t variant-scorer-pt:latest .
#
# Run (Docker):
#   docker run --gpus all -v /data:/data variant-scorer-pt:latest \
#       python /app/variant_scoring_pt.py --help
#
# Convert to Singularity:
#   singularity build variant-scorer-pt.sif docker-daemon://variant-scorer-pt:latest
# ─────────────────────────────────────────────────────────────────────────────

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

# ── System dependencies ───────────────────────────────────────────────────────
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-dev \
        wget \
        curl \
        git \
        tabix \
        bgzip \
        bcftools \
        bedtools \
        libhdf5-dev \
        libgsl-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Make python3 the default python
RUN ln -sf /usr/bin/python3 /usr/bin/python

# ── Python dependencies ───────────────────────────────────────────────────────
# Install PyTorch with CUDA 12.4 support first (before other packages
# to avoid pip pulling in a CPU-only torch as a dependency)
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
        torch==2.3.1+cu124 \
        torchvision==0.18.1+cu124 \
        --index-url https://download.pytorch.org/whl/cu124

# Core scientific stack
RUN pip3 install --no-cache-dir \
        numpy \
        pandas \
        scipy \
        matplotlib \
        h5py \
        tqdm \
        pyfaidx

# ChromBPNet / variant scoring dependencies
RUN pip3 install --no-cache-dir \
        bpnet-lite \
        tangermeme

# ── Install repo ──────────────────────────────────────────────────────────────
WORKDIR /app
RUN git clone https://github.com/grandrews7/variant-scorer-pt.git .

# ── Environment ───────────────────────────────────────────────────────────────
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# ── Entrypoint ────────────────────────────────────────────────────────────────
ENTRYPOINT ["python", "/app/variant_scoring_pt.py"]
CMD ["--help"]
