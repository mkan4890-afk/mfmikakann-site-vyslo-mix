FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# LIVE の中継用: 無料・登録不要の Cloudflare WARP を HTTP プロキシとして使う (wgcf + wireproxy)
RUN python -c "import urllib.request,tarfile,io,os; \
urllib.request.urlretrieve('https://github.com/ViRb3/wgcf/releases/download/v2.2.29/wgcf_2.2.29_linux_amd64','/usr/local/bin/wgcf'); \
t=tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen('https://github.com/windtf/wireproxy/releases/download/v1.1.3/wireproxy_linux_amd64.tar.gz').read())); \
open('/usr/local/bin/wireproxy','wb').write(t.extractfile([m for m in t.getmembers() if m.name.endswith('wireproxy')][0]).read()); \
[os.chmod(f,0o755) for f in ('/usr/local/bin/wgcf','/usr/local/bin/wireproxy')]" || true
COPY . .
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
