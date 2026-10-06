(() => {
  const canvas = document.createElement('canvas');
  canvas.id = 'starfield';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let W, H, stars, orbs;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function init() {
    stars = Array.from({ length: 160 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.2,
      alpha: Math.random() * 0.6 + 0.15,
      vy: Math.random() * 0.12 + 0.02,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      color: ['#ffffff', '#ede9fe', '#c4b5fd', '#ddd6fe', '#e9d5ff'][Math.floor(Math.random() * 5)]
    }));

    orbs = [
      { x: W * 0.12, y: H * 0.12, r: W * 0.35, color: 'rgba(99,102,241,0.05)', vx: 0.15, vy: 0.08 },
      { x: W * 0.75, y: H * 0.2,  r: W * 0.3,  color: 'rgba(139,92,246,0.04)', vx: -0.1, vy: 0.12 },
      { x: W * 0.45, y: H * 0.65, r: W * 0.4,  color: 'rgba(34,211,238,0.025)', vx: 0.08, vy: -0.06 },
      { x: W * 0.85, y: H * 0.75, r: W * 0.28, color: 'rgba(244,114,182,0.02)', vx: -0.12, vy: -0.1 }
    ];
  }

  function draw() {
    ctx.fillStyle = '#06060a';
    ctx.fillRect(0, 0, W, H);

    // Draw floating gradient orbs
    orbs.forEach(o => {
      o.x += o.vx;
      o.y += o.vy;
      if (o.x < -o.r) o.x = W + o.r;
      if (o.x > W + o.r) o.x = -o.r;
      if (o.y < -o.r) o.y = H + o.r;
      if (o.y > H + o.r) o.y = -o.r;

      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      g.addColorStop(0, o.color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });

    // Draw stars with twinkle
    stars.forEach(s => {
      s.y += s.vy;
      if (s.y > H) s.y = 0;
      s.twinkle += s.twinkleSpeed;
      const alpha = s.alpha * (0.6 + 0.4 * Math.sin(s.twinkle));

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = alpha;
      ctx.fill();

      // Glow for brighter stars
      if (s.r > 1.0) {
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  resize();
  init();
  draw();
  window.addEventListener('resize', () => { resize(); init(); });
})();
