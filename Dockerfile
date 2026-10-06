# VYSLO MIX — MUSIC + TUBE + CHAT + CLOUDMOON + UTOPIA in one service
# Gateway (Node) on $PORT, apps on internal ports (supervisord manages all).
FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NITRO_PORT=8003

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip supervisor ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- gateway deps ---
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- python deps (music + tube) ---
COPY apps/music/requirements.txt apps/music/
COPY apps/tube/requirements.txt apps/tube/
RUN pip3 install --no-cache-dir --break-system-packages \
      -r apps/music/requirements.txt \
      -r apps/tube/requirements.txt

# --- WARP tools for TUBE live relay (best effort; failures are non-fatal) ---
RUN python3 -c "import urllib.request,tarfile,io,os; \
urllib.request.urlretrieve('https://github.com/ViRb3/wgcf/releases/download/v2.2.29/wgcf_2.2.29_linux_amd64','/usr/local/bin/wgcf'); \
t=tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen('https://github.com/windtf/wireproxy/releases/download/v1.1.3/wireproxy_linux_amd64.tar.gz').read())); \
open('/usr/local/bin/wireproxy','wb').write(t.extractfile([m for m in t.getmembers() if m.name.endswith('wireproxy')][0]).read()); \
[os.chmod(f,0o755) for f in ('/usr/local/bin/wgcf','/usr/local/bin/wireproxy')]" || true

# --- app sources (chat ships prebuilt .output, built with NITRO_PRESET=node-server) ---
COPY . .

EXPOSE 8080
CMD ["supervisord", "-c", "/app/supervisord.conf"]
