"use strict";

(() => {
  const canvas = document.getElementById("geometryCanvas");
  const shell = document.getElementById("canvasShell");
  const ctx = canvas.getContext("2d");

  const $ = id => document.getElementById(id);
  const status = $("status");
  const help = $("helpText");
  const props = $("propertiesText");
  const coords = $("coordinates");
  const zoomLabel = $("zoomValue");

  let W = 0, H = 0, dpr = 1;
  let scale = 40, ox = 0, oy = 0;
  let objects = [], history = [], nextId = 1;
  let tool = "select", pending = [], polygonIds = [];
  let dragPoint = null, dragBefore = null, panStart = null, selectedId = null;

  const palette = {
    point: "#67e8f9",
    segment: "#a78bfa",
    line: "#c4b5fd",
    circle: "#38bdf8",
    polygon: "#34d399",
    angle: "#fbbf24",
    perpbis: "#f0abfc",
    bisector: "#fb923c",
    derived: "#f472b6"
  };

  const toolNames = {
    select: "انتخاب و جابه‌جایی",
    point: "نقطه",
    segment: "پاره‌خط",
    line: "خط",
    circle: "دایره",
    polygon: "چندضلعی",
    angle: "اندازه‌گیری زاویه",
    midpoint: "نقطهٔ وسط",
    perp: "عمودمنصف",
    bisector: "نیمساز زاویه"
  };

  const depNames = {
    midpoint: "نقطهٔ وسط",
    centroid: "مرکز ثقل",
    circumcenter: "مرکز دایرهٔ محیطی",
    incenter: "مرکز دایرهٔ محاطی",
    orthocenter: "مرکز ارتفاعی"
  };

  const fmt = n => Number.isFinite(n) ? String(+n.toFixed(3)) : "—";
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const getPoint = id => objects.find(o => o.id === id && o.type === "point");
  const snapPoint = p => $("snapToggle")?.checked
    ? { x: Math.round(p.x), y: Math.round(p.y) }
    : p;

  function say(text) {
    status.textContent = text;
  }

  /* ---------- history / persistence ---------- */

  // Runs one user action as a single undo step. A snapshot is stored only
  // when the action actually changed something.
  function transact(fn) {
    const before = JSON.stringify(objects);
    fn();
    if (JSON.stringify(objects) !== before) pushHistory(before);
    refresh();
  }

  function pushHistory(serialized) {
    history.push(serialized);
    if (history.length > 60) history.shift();
  }

  function refresh() {
    saveLocal();
    draw();
    updateProperties();
  }

  function saveLocal() {
    try {
      localStorage.setItem("SAM MATH_GEOMETRY_STUDIO", JSON.stringify({
        objects, nextId, scale
      }));
    } catch (_) {
      say("مرورگر اجازهٔ ذخیرهٔ محلی نداد.");
    }
  }

  /* ---------- coordinates ---------- */

  function worldToScreen(p) {
    return { x: ox + p.x * scale, y: oy - p.y * scale };
  }

  function screenToWorld(x, y) {
    return { x: (x - ox) / scale, y: (oy - y) / scale };
  }

  function canvasPosition(event) {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  /* ---------- object creation (no history / redraw here) ---------- */

  function addObject(data) {
    const object = { id: nextId++, ...data };
    objects.push(object);
    selectedId = object.id;
    return object;
  }

  function nextLabel() {
    const used = new Set(objects.filter(o => o.type === "point").map(o => o.label));
    for (let i = 0; ; i++) {
      const label = String.fromCharCode(65 + i % 26) + (i >= 26 ? Math.floor(i / 26) : "");
      if (!used.has(label)) return label;
    }
  }

  function uniqueLabel(base) {
    const used = new Set(objects.filter(o => o.type === "point").map(o => o.label));
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(base + i)) return base + i;
  }

  function createPoint(p) {
    return addObject({ type: "point", x: p.x, y: p.y, label: nextLabel() });
  }

  // A point whose position is computed from other points (moves with them).
  function addDerivedPoint(kind, base, of) {
    const p = addObject({
      type: "point", x: 0, y: 0, label: uniqueLabel(base), dep: { kind, of }
    });
    computeDep(p);
    return p;
  }

  function createLineBetween(a, b, type) {
    if (!a || !b || a.id === b.id) {
      say("دو نقطهٔ متفاوت انتخاب کن.");
      return;
    }
    addObject({ type, a: a.id, b: b.id });
    pending = [];
    say(type === "line" ? "خط رسم شد." : "پاره‌خط رسم شد.");
  }

  /* ---------- geometry helpers ---------- */

  function radiusOf(o) {
    if (o.inradius) {
      const P = o.inradius.map(getPoint);
      if (P.every(Boolean)) {
        const [a, b, c] = P;
        const perimeter = dist(b, c) + dist(c, a) + dist(a, b);
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        return perimeter > 1e-9 ? 2 * area / perimeter : 0;
      }
    }
    const c = getPoint(o.center);
    const through = o.through != null ? getPoint(o.through) : null;
    return c && through ? dist(c, through) : o.radius;
  }

  function circumcenter(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y;
    const b2 = b.x * b.x + b.y * b.y;
    const c2 = c.x * c.x + c.y * c.y;
    return {
      x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
      y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
    };
  }

  function computeDep(p) {
    const P = p.dep.of.map(getPoint);
    if (P.some(q => !q)) return;
    const [a, b, c] = P;
    let r = null;

    if (p.dep.kind === "midpoint") {
      r = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (p.dep.kind === "centroid") {
      r = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    } else if (p.dep.kind === "circumcenter") {
      r = circumcenter(a, b, c);
    } else if (p.dep.kind === "incenter") {
      const la = dist(b, c), lb = dist(c, a), lc = dist(a, b);
      const s = la + lb + lc;
      if (s > 1e-9) r = { x: (la * a.x + lb * b.x + lc * c.x) / s, y: (la * a.y + lb * b.y + lc * c.y) / s };
    } else if (p.dep.kind === "orthocenter") {
      const o = circumcenter(a, b, c);
      if (o) r = { x: a.x + b.x + c.x - 2 * o.x, y: a.y + b.y + c.y - 2 * o.y };
    }

    if (r) {
      p.x = r.x;
      p.y = r.y;
    }
  }

  // Parents are always created before children, so one pass in order is enough.
  function updateDependents() {
    for (const o of objects) if (o.type === "point" && o.dep) computeDep(o);
  }

  function perpBisectorScreen(o) {
    const a = getPoint(o.a), b = getPoint(o.b);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    return {
      m: worldToScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      dir: { x: -dy / len, y: -dx / len }
    };
  }

  function bisectorScreen(o) {
    const a = getPoint(o.a), v = getPoint(o.vertex), c = getPoint(o.c);
    if (!a || !v || !c) return null;
    const ul = Math.hypot(a.x - v.x, a.y - v.y);
    const wl = Math.hypot(c.x - v.x, c.y - v.y);
    if (ul < 1e-9 || wl < 1e-9) return null;
    const ux = (a.x - v.x) / ul, uy = (a.y - v.y) / ul;
    const wx = (c.x - v.x) / wl, wy = (c.y - v.y) / wl;
    let dx = ux + wx, dy = uy + wy;
    let len = Math.hypot(dx, dy);
    if (len < 1e-9) { dx = -uy; dy = ux; len = 1; }
    return { q: worldToScreen(v), dir: { x: dx / len, y: -dy / len } };
  }

  function polygonStats(ps) {
    const perimeter = ps.reduce((sum, p, i) => sum + dist(p, ps[(i + 1) % ps.length]), 0);
    let area = 0;
    ps.forEach((p, i) => {
      const q = ps[(i + 1) % ps.length];
      area += p.x * q.y - q.x * p.y;
    });
    return { perimeter, area: Math.abs(area) / 2 };
  }

  function angleDegrees(o) {
    const a = getPoint(o.a), v = getPoint(o.vertex), c = getPoint(o.c);
    if (!a || !v || !c) return null;
    const ux = a.x - v.x, uy = a.y - v.y;
    const wx = c.x - v.x, wy = c.y - v.y;
    const den = Math.hypot(ux, uy) * Math.hypot(wx, wy);
    if (den < 1e-9) return null;
    const cos = Math.max(-1, Math.min(1, (ux * wx + uy * wy) / den));
    return Math.acos(cos) * 180 / Math.PI;
  }

  /* ---------- hit testing ---------- */

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function distToLine(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!len) return Infinity;
    return Math.abs((px - ax) * dy - (py - ay) * dx) / len;
  }

  function pointInPolygon(px, py, ss) {
    let inside = false;
    for (let i = 0, j = ss.length - 1; i < ss.length; j = i++) {
      const a = ss[i], b = ss[j];
      if ((a.y > py) !== (b.y > py) &&
          px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function hitPoint(x, y) {
    let result = null, best = 15;
    for (const p of objects.filter(o => o.type === "point")) {
      const s = worldToScreen(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < best) {
        best = d;
        result = p;
      }
    }
    return result;
  }

  // Finds a non-point shape under the cursor. Edges win over polygon interiors.
  function hitShape(x, y) {
    const tol = 8;

    for (let k = objects.length - 1; k >= 0; k--) {
      const o = objects[k];

      if (o.type === "segment" || o.type === "line") {
        const a = getPoint(o.a), b = getPoint(o.b);
        if (!a || !b) continue;
        const p = worldToScreen(a), q = worldToScreen(b);
        const d = o.type === "line"
          ? distToLine(x, y, p.x, p.y, q.x, q.y)
          : distToSegment(x, y, p.x, p.y, q.x, q.y);
        if (d < tol) return o;
      } else if (o.type === "circle") {
        const c = getPoint(o.center);
        if (!c) continue;
        const p = worldToScreen(c);
        if (Math.abs(Math.hypot(x - p.x, y - p.y) - radiusOf(o) * scale) < tol) return o;
      } else if (o.type === "perpbis") {
        const s = perpBisectorScreen(o);
        if (!s) continue;
        if (distToLine(x, y, s.m.x, s.m.y, s.m.x + s.dir.x, s.m.y + s.dir.y) < tol) return o;
      } else if (o.type === "bisector") {
        const s = bisectorScreen(o);
        if (!s) continue;
        const reach = Math.hypot(W, H) * 2;
        if (distToSegment(x, y, s.q.x, s.q.y, s.q.x + s.dir.x * reach, s.q.y + s.dir.y * reach) < tol) return o;
      } else if (o.type === "angle") {
        const a = getPoint(o.a), v = getPoint(o.vertex), c = getPoint(o.c);
        if (!a || !v || !c) continue;
        const p = worldToScreen(a), q = worldToScreen(v), r = worldToScreen(c);
        if (distToSegment(x, y, p.x, p.y, q.x, q.y) < tol ||
            distToSegment(x, y, q.x, q.y, r.x, r.y) < tol) return o;
      } else if (o.type === "polygon") {
        const ss = o.points.map(getPoint).filter(Boolean).map(worldToScreen);
        for (let i = 0; i < ss.length; i++) {
          const s = ss[i], t = ss[(i + 1) % ss.length];
          if (distToSegment(x, y, s.x, s.y, t.x, t.y) < tol) return o;
        }
      }
    }

    for (let k = objects.length - 1; k >= 0; k--) {
      const o = objects[k];
      if (o.type !== "polygon") continue;
      const ss = o.points.map(getPoint).filter(Boolean).map(worldToScreen);
      if (ss.length >= 3 && pointInPolygon(x, y, ss)) return o;
    }

    return null;
  }

  /* ---------- canvas sizing ---------- */

  function resize() {
    const rect = shell.getBoundingClientRect();
    W = Math.max(280, rect.width);
    H = Math.max(300, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";

    if (!ox || !oy) {
      ox = W / 2;
      oy = H / 2;
    } else {
      ox = Math.max(-W * 2, Math.min(W * 3, ox));
      oy = Math.max(-H * 2, Math.min(H * 3, oy));
    }
    draw();
  }

  /* ---------- drawing ---------- */

  function drawGrid() {
    ctx.fillStyle = "#0b1221";
    ctx.fillRect(0, 0, W, H);

    const unit = scale >= 70 ? 1 : scale >= 30 ? 2 : 5;
    const spacing = unit * scale;
    ctx.strokeStyle = "rgba(148,163,184,.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = ((ox % spacing) + spacing) % spacing; x < W; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = ((oy % spacing) + spacing) % spacing; y < H; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#9aabc4";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(W, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, H);
    ctx.stroke();

    ctx.fillStyle = "#9aabc4";
    ctx.font = "12px system-ui";
    ctx.fillText("x", W - 18, oy - 8);
    ctx.fillText("y", ox + 8, 15);
    ctx.fillText("O", ox + 6, oy + 15);

    for (let i = -100; i <= 100; i += unit) {
      if (i === 0) continue;
      const x = ox + i * scale, y = oy - i * scale;
      if (x > 0 && x < W) ctx.fillText(String(i), x + 3, oy + 15);
      if (y > 0 && y < H) ctx.fillText(String(i), ox + 6, y - 4);
    }
  }

  function drawPoint(p) {
    const s = worldToScreen(p);
    ctx.beginPath();
    ctx.arc(s.x, s.y, selectedId === p.id ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = selectedId === p.id ? "#fff" : (p.dep ? palette.derived : palette.point);
    ctx.fill();
    ctx.strokeStyle = p.dep ? palette.derived : palette.point;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "bold 13px system-ui";
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(p.label, s.x + 9, s.y - 8);
    ctx.font = "11px system-ui";
    ctx.fillStyle = "#9aabc4";
    ctx.fillText(`(${fmt(p.x)}, ${fmt(p.y)})`, s.x + 9, s.y + 9);
  }

  function drawSegment(o) {
    const a = getPoint(o.a), b = getPoint(o.b);
    if (!a || !b) return;

    const p = worldToScreen(a), q = worldToScreen(b);
    const dx = q.x - p.x, dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;

    ctx.strokeStyle = palette[o.type];
    ctx.lineWidth = selectedId === o.id ? 4 : 2.5;
    ctx.beginPath();

    if (o.type === "line") {
      const reach = Math.hypot(W, H) * 2;
      ctx.moveTo(p.x - dx / length * reach, p.y - dy / length * reach);
      ctx.lineTo(p.x + dx / length * reach, p.y + dy / length * reach);
    } else {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();

    if (o.type === "segment") {
      ctx.fillStyle = "#ddd6fe";
      ctx.font = "12px system-ui";
      ctx.fillText(`طول ${fmt(dist(a, b))}`,
        (p.x + q.x) / 2 + 6, (p.y + q.y) / 2 - 7);
    }
  }

  function drawPerpBisector(o) {
    const s = perpBisectorScreen(o);
    if (!s) return;
    const reach = Math.hypot(W, H) * 2;

    ctx.save();
    ctx.strokeStyle = palette.perpbis;
    ctx.lineWidth = selectedId === o.id ? 4 : 2.2;
    ctx.setLineDash([9, 6]);
    ctx.beginPath();
    ctx.moveTo(s.m.x - s.dir.x * reach, s.m.y - s.dir.y * reach);
    ctx.lineTo(s.m.x + s.dir.x * reach, s.m.y + s.dir.y * reach);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = palette.perpbis;
    ctx.font = "12px system-ui";
    ctx.fillText("عمودمنصف", s.m.x + 8, s.m.y - 8);
  }

  function drawBisector(o) {
    const s = bisectorScreen(o);
    if (!s) return;
    const reach = Math.hypot(W, H) * 2;

    ctx.save();
    ctx.strokeStyle = palette.bisector;
    ctx.lineWidth = selectedId === o.id ? 4 : 2.2;
    ctx.setLineDash([9, 6]);
    ctx.beginPath();
    ctx.moveTo(s.q.x, s.q.y);
    ctx.lineTo(s.q.x + s.dir.x * reach, s.q.y + s.dir.y * reach);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = palette.bisector;
    ctx.font = "12px system-ui";
    ctx.fillText("نیمساز", s.q.x + s.dir.x * 70 + 6, s.q.y + s.dir.y * 70 - 6);
  }

  function drawCircle(o) {
    const c = getPoint(o.center);
    if (!c) return;
    const p = worldToScreen(c);
    const radius = radiusOf(o);

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * scale, 0, Math.PI * 2);
    ctx.strokeStyle = palette.circle;
    ctx.lineWidth = selectedId === o.id ? 4 : 2.5;
    ctx.stroke();

    ctx.fillStyle = "#bae6fd";
    ctx.font = "12px system-ui";
    ctx.fillText(`r = ${fmt(radius)}`, p.x + radius * scale * .55, p.y - 8);
  }

  function drawPolygon(o) {
    const ps = o.points.map(getPoint);
    if (ps.length < 3 || ps.some(p => !p)) return;
    const ss = ps.map(worldToScreen);

    ctx.beginPath();
    ctx.moveTo(ss[0].x, ss[0].y);
    ss.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = "rgba(52,211,153,.12)";
    ctx.fill();
    ctx.strokeStyle = palette.polygon;
    ctx.lineWidth = selectedId === o.id ? 4 : 2.5;
    ctx.stroke();

    const { perimeter, area } = polygonStats(ps);
    const cx = ss.reduce((sum, p) => sum + p.x, 0) / ss.length;
    const cy = ss.reduce((sum, p) => sum + p.y, 0) / ss.length;

    ctx.fillStyle = "#a7f3d0";
    ctx.font = "12px system-ui";
    ctx.fillText(`محیط ${fmt(perimeter)}`, cx + 5, cy);
    ctx.fillText(`مساحت ${fmt(area)}`, cx + 5, cy + 15);
  }

  function drawAngle(o) {
    const a = getPoint(o.a), v = getPoint(o.vertex), c = getPoint(o.c);
    const degrees = angleDegrees(o);
    if (!a || !v || !c || degrees === null) return;

    const p = worldToScreen(a), q = worldToScreen(v), r = worldToScreen(c);
    ctx.strokeStyle = palette.angle;
    ctx.lineWidth = selectedId === o.id ? 4 : 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();

    // Directions of both rays on screen, and the signed sweep between them
    // (always the smaller of the two possible angles).
    const a1 = Math.atan2(p.y - q.y, p.x - q.x);
    const a2 = Math.atan2(r.y - q.y, r.x - q.x);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;

    ctx.lineWidth = 1.8;
    ctx.beginPath();

    if (Math.abs(degrees - 90) < 0.5) {
      // Right angle: small square marker.
      const s = 16;
      const e1 = { x: Math.cos(a1), y: Math.sin(a1) };
      const e2 = { x: Math.cos(a2), y: Math.sin(a2) };
      ctx.moveTo(q.x + e1.x * s, q.y + e1.y * s);
      ctx.lineTo(q.x + (e1.x + e2.x) * s, q.y + (e1.y + e2.y) * s);
      ctx.lineTo(q.x + e2.x * s, q.y + e2.y * s);
    } else {
      ctx.arc(q.x, q.y, 28, a1, a1 + sweep, sweep < 0);
    }
    ctx.stroke();

    const mid = a1 + sweep / 2;
    ctx.fillStyle = "#fde68a";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${fmt(degrees)}°`, q.x + Math.cos(mid) * 48, q.y + Math.sin(mid) * 48);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function draw() {
    if (!canvas.width || !canvas.height) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateDependents();
    drawGrid();

    for (const o of objects) {
      if (o.type === "segment" || o.type === "line") drawSegment(o);
      if (o.type === "circle") drawCircle(o);
      if (o.type === "polygon") drawPolygon(o);
      if (o.type === "angle") drawAngle(o);
      if (o.type === "perpbis") drawPerpBisector(o);
      if (o.type === "bisector") drawBisector(o);
    }
    for (const p of objects.filter(o => o.type === "point")) drawPoint(p);

    if (polygonIds.length) {
      const ps = polygonIds.map(getPoint).filter(Boolean).map(worldToScreen);
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#fbbf24";
      ctx.beginPath();
      ps.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
      ctx.restore();
    }

    zoomLabel.textContent = Math.round(scale / 40 * 100) + "%";
  }

  /* ---------- properties panel ---------- */

  function updateProperties() {
    const o = objects.find(o => o.id === selectedId);
    if (!o) {
      props.textContent = "هنوز شکلی انتخاب نشده است.";
      return;
    }

    if (o.type === "point") {
      const kind = o.dep ? ` · ${depNames[o.dep.kind] || "وابسته"}` : "";
      props.innerHTML = `<b>نقطه ${o.label}</b>${kind}<br>x: ${fmt(o.x)}<br>y: ${fmt(o.y)}`;
    } else if (o.type === "segment") {
      const a = getPoint(o.a), b = getPoint(o.b);
      props.textContent = a && b
        ? `پاره‌خط · طول: ${fmt(dist(a, b))} واحد`
        : "پاره‌خط";
    } else if (o.type === "circle") {
      const r = radiusOf(o);
      props.textContent =
        `${o.name || "دایره"} · شعاع: ${fmt(r)} · محیط: ${fmt(2 * Math.PI * r)} · مساحت: ${fmt(Math.PI * r ** 2)}`;
    } else if (o.type === "polygon") {
      const ps = o.points.map(getPoint).filter(Boolean);
      const { perimeter, area } = polygonStats(ps);
      props.textContent = `چندضلعی · تعداد رأس: ${ps.length} · محیط: ${fmt(perimeter)} · مساحت: ${fmt(area)}`;
    } else if (o.type === "line") {
      props.textContent = o.name || "خط بی‌نهایت از دو نقطه";
    } else if (o.type === "perpbis") {
      const a = getPoint(o.a), b = getPoint(o.b);
      props.textContent = a && b
        ? `عمودمنصف پاره‌خط ${a.label}${b.label} · از وسط آن می‌گذرد و بر آن عمود است`
        : "عمودمنصف";
    } else if (o.type === "bisector") {
      const a = getPoint(o.a), v = getPoint(o.vertex), c = getPoint(o.c);
      const full = angleDegrees(o);
      props.textContent = a && v && c && full !== null
        ? `نیمساز زاویهٔ ${a.label}${v.label}${c.label} · هر نیمه ${fmt(full / 2)} درجه`
        : "نیمساز";
    } else if (o.type === "angle") {
      const degrees = angleDegrees(o);
      props.textContent = degrees === null
        ? "زاویه"
        : `زاویه · ${fmt(degrees)} درجه`;
    }
  }

  /* ---------- tools ---------- */

  function setTool(next) {
    tool = next;
    pending = [];
    polygonIds = [];

    document.querySelectorAll("[data-tool]").forEach(button =>
      button.classList.toggle("active", button.dataset.tool === tool));

    const instructions = {
      select: "روی نقطه یا هر شکل کلیک کن تا انتخاب شود. نقطه را بکش تا جابه‌جا شود، فضای خالی را بکش تا صفحه حرکت کند، و برای پاک‌کردن دکمهٔ حذف یا Delete را بزن.",
      point: "روی بوم کلیک کن تا نقطه بسازی.",
      segment: "برای پاره‌خط دو نقطه را انتخاب کن.",
      line: "برای خط، دو نقطه را انتخاب کن.",
      circle: "مرکز دایره و سپس نقطه‌ای روی محیط را انتخاب کن.",
      polygon: "رأس‌ها را انتخاب کن؛ برای پایان Enter یا دکمهٔ «پایان چندضلعی» را بزن.",
      angle: "سه نقطه را انتخاب کن: ضلع اول، رأس زاویه، ضلع دوم.",
      midpoint: "دو نقطه را انتخاب کن تا نقطهٔ وسطشان ساخته شود. با جابه‌جایی نقاط، وسط هم جابه‌جا می‌شود.",
      perp: "دو سر پاره‌خط را انتخاب کن تا عمودمنصفش رسم شود.",
      bisector: "سه نقطه را انتخاب کن: ضلع اول، رأس زاویه، ضلع دوم تا نیمساز رسم شود."
    };

    help.textContent = instructions[tool] || "";
    say("ابزار انتخاب‌شده: " + (toolNames[tool] || tool));
    draw();
  }

  function dependsOnPoint(o, id) {
    switch (o.type) {
      case "segment":
      case "line":
      case "perpbis": return o.a === id || o.b === id;
      case "circle": return o.center === id || o.through === id || (o.inradius ? o.inradius.includes(id) : false);
      case "point": return !!o.dep && o.dep.of.includes(id);
      case "polygon": return o.points.includes(id);
      case "angle":
      case "bisector": return o.a === id || o.vertex === id || o.c === id;
      default: return false;
    }
  }

  // Everything that (directly or through other shapes) is built on a point.
  function collectDependents(id) {
    const dead = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const o of objects) {
        if (dead.has(o.id)) continue;
        for (const d of dead) {
          if (dependsOnPoint(o, d)) {
            dead.add(o.id);
            changed = true;
            break;
          }
        }
      }
    }
    return dead;
  }

  // Deleting a point also removes every shape built on it.
  function deleteSelected() {
    const target = objects.find(o => o.id === selectedId);
    if (!target) {
      say("اول یک شکل یا نقطه را انتخاب کن.");
      return;
    }

    let removed = 0;
    transact(() => {
      const count = objects.length;
      const dead = target.type === "point" ? collectDependents(target.id) : new Set([target.id]);
      objects = objects.filter(o => !dead.has(o.id));
      removed = count - objects.length;
      selectedId = null;
      pending = [];
      polygonIds = [];
    });

    if (target.type === "point") {
      say(removed > 1 ? `نقطه و ${removed - 1} شکل وابسته به آن حذف شد.` : "نقطه حذف شد.");
    } else {
      say("شکل حذف شد.");
    }
  }

  function addTriangleCenters() {
    const selected = objects.find(o => o.id === selectedId);
    const tri = selected && selected.type === "polygon" && selected.points.length === 3
      ? selected
      : [...objects].reverse().find(o => o.type === "polygon" && o.points.length === 3);

    if (!tri) {
      say("اول یک مثلث بساز: ابزار چندضلعی با ۳ رأس، یا دستور triangle.");
      return;
    }

    const pts = tri.points.map(getPoint);
    if (pts.some(p => !p) || !circumcenter(pts[0], pts[1], pts[2])) {
      say("این مثلث تبهگون است (سه رأس روی یک خط).");
      return;
    }

    const ids = [...tri.points];
    transact(() => {
      addDerivedPoint("centroid", "G", ids);
      const O = addDerivedPoint("circumcenter", "O", ids);
      const I = addDerivedPoint("incenter", "I", ids);
      const H = addDerivedPoint("orthocenter", "H", ids);
      addObject({ type: "circle", name: "دایرهٔ محیطی", center: O.id, through: ids[0], radius: 0 });
      addObject({ type: "circle", name: "دایرهٔ محاطی", center: I.id, inradius: ids, radius: 0 });
      addObject({ type: "line", name: "خط اویلر (از O و H و G می‌گذرد)", a: O.id, b: H.id });
    });
    say("مراکز مثلث، دایرهٔ محیطی و محاطی و خط اویلر ساخته شد.");
  }

  function finishPolygon() {
    if (polygonIds.length < 3) {
      say("برای چندضلعی حداقل سه رأس لازم است.");
      return;
    }
    transact(() => addObject({ type: "polygon", points: [...polygonIds] }));
    polygonIds = [];
    draw();
    say("چندضلعی ساخته شد.");
  }

  // Called inside transact(), so every click is one undo step.
  function handleClick(x, y) {
    const p = snapPoint(screenToWorld(x, y));
    const hit = hitPoint(x, y);

    if (tool === "point") {
      createPoint(p);
      say("نقطه ساخته شد.");
      return;
    }

    if (tool === "segment" || tool === "line") {
      pending.push(hit || createPoint(p));
      if (pending.length === 2) createLineBetween(pending[0], pending[1], tool);
      else say("حالا نقطهٔ دوم را انتخاب کن.");
      return;
    }

    if (tool === "circle") {
      pending.push(hit || createPoint(p));
      if (pending.length === 1) {
        say("حالا شعاع را با کلیک دوم تعیین کن.");
      } else {
        const center = pending[0], through = pending[1];
        const radius = dist(center, through);
        if (radius > 0) {
          addObject({ type: "circle", center: center.id, through: through.id, radius });
          say("دایره ساخته شد.");
        } else {
          say("نقطهٔ دوم باید با مرکز فرق داشته باشد.");
        }
        pending = [];
      }
      return;
    }

    if (tool === "polygon") {
      const point = hit || createPoint(p);
      if (!polygonIds.includes(point.id)) polygonIds.push(point.id);
      say(`رأس ${polygonIds.length} اضافه شد. برای پایان، Enter را بزن.`);
      return;
    }

    if (tool === "midpoint") {
      pending.push(hit || createPoint(p));
      if (pending.length === 2) {
        const [a, b] = pending;
        pending = [];
        if (a.id === b.id) {
          say("دو نقطهٔ متفاوت انتخاب کن.");
        } else {
          addDerivedPoint("midpoint", "M", [a.id, b.id]);
          say("نقطهٔ وسط ساخته شد.");
        }
      } else {
        say("حالا نقطهٔ دوم را انتخاب کن.");
      }
      return;
    }

    if (tool === "perp") {
      pending.push(hit || createPoint(p));
      if (pending.length === 2) {
        const [a, b] = pending;
        pending = [];
        if (a.id === b.id) {
          say("دو نقطهٔ متفاوت انتخاب کن.");
        } else {
          addObject({ type: "perpbis", a: a.id, b: b.id });
          say("عمودمنصف رسم شد.");
        }
      } else {
        say("حالا نقطهٔ دوم را انتخاب کن.");
      }
      return;
    }

    if (tool === "bisector") {
      pending.push(hit || createPoint(p));
      if (pending.length === 3) {
        const [a, v, c] = pending;
        pending = [];
        addObject({ type: "bisector", a: a.id, vertex: v.id, c: c.id });
        say("نیمساز رسم شد.");
      } else {
        say(`نقطهٔ ${pending.length} از ۳ را انتخاب کن.`);
      }
      return;
    }

    if (tool === "angle") {
      pending.push(hit || createPoint(p));
      if (pending.length === 3) {
        addObject({ type: "angle", a: pending[0].id, vertex: pending[1].id, c: pending[2].id });
        pending = [];
        say("زاویه ساخته شد.");
      } else {
        say(`نقطهٔ ${pending.length} از ۳ را انتخاب کن.`);
      }
    }
  }

  /* ---------- pointer events ---------- */

  canvas.addEventListener("pointerdown", event => {
    const p = canvasPosition(event);

    if (tool === "select") {
      const hit = hitPoint(p.x, p.y);

      if (hit) {
        selectedId = hit.id;
        if (!hit.dep) {
          dragPoint = { id: hit.id };
          dragBefore = JSON.stringify(objects);
        }
      } else {
        const shape = hitShape(p.x, p.y);
        if (shape) {
          selectedId = shape.id;
        } else {
          selectedId = null;
          panStart = { x: p.x, y: p.y, ox, oy };
        }
      }

      canvas.setPointerCapture(event.pointerId);
      updateProperties();
      draw();
      return;
    }

    transact(() => handleClick(p.x, p.y));
  });

  canvas.addEventListener("pointermove", event => {
    const p = canvasPosition(event);
    const w = screenToWorld(p.x, p.y);
    coords.textContent = `x: ${fmt(w.x)} · y: ${fmt(w.y)}`;

    if (dragPoint) {
      const point = getPoint(dragPoint.id);
      if (point) {
        const target = snapPoint(w);
        point.x = target.x;
        point.y = target.y;
        draw();
        updateProperties();
      }
    } else if (panStart) {
      ox = panStart.ox + p.x - panStart.x;
      oy = panStart.oy + p.y - panStart.y;
      draw();
    }
  });

  function endPointer() {
    if (dragPoint && dragBefore !== null && JSON.stringify(objects) !== dragBefore) {
      pushHistory(dragBefore);
    }
    if (dragPoint || panStart) saveLocal();
    dragPoint = null;
    dragBefore = null;
    panStart = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const p = canvasPosition(event);
    const before = screenToWorld(p.x, p.y);
    scale = Math.max(8, Math.min(150, scale * (event.deltaY < 0 ? 1.1 : .9)));
    ox = p.x - before.x * scale;
    oy = p.y + before.y * scale;
    draw();
    saveLocal();
  }, { passive: false });

  /* ---------- toolbar buttons ---------- */

  document.querySelectorAll("[data-tool]").forEach(button =>
    button.addEventListener("click", () => setTool(button.dataset.tool)));

  $("finishPolygonBtn")?.addEventListener("click", finishPolygon);
  $("deleteBtn")?.addEventListener("click", deleteSelected);
  $("centersBtn")?.addEventListener("click", addTriangleCenters);

  $("pngBtn")?.addEventListener("click", () => {
    canvas.toBlob(blob => {
      if (!blob) {
        say("ساخت تصویر ممکن نشد.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mathora-geometry.png";
      a.click();
      URL.revokeObjectURL(url);
      say("تصویر ذخیره شد.");
    });
  });

  $("undoBtn").addEventListener("click", () => {
    if (!history.length) {
      say("تغییری برای بازگشت وجود ندارد.");
      return;
    }
    objects = JSON.parse(history.pop());
    nextId = objects.reduce((max, o) => Math.max(max, o.id), 0) + 1;
    pending = [];
    polygonIds = [];
    selectedId = null;
    refresh();
    say("آخرین تغییر برگشت داده شد.");
  });

  function clearAll() {
    if (!objects.length) {
      say("بوم از قبل خالی است.");
      return;
    }
    transact(() => {
      objects = [];
      pending = [];
      polygonIds = [];
      selectedId = null;
      nextId = 1;
    });
    say("بوم پاک شد. با «بازگشت» می‌توانی برش گردانی.");
  }

  $("clearBtn").addEventListener("click", clearAll);
  $("clearAllBtn")?.addEventListener("click", clearAll);

  $("saveBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ objects, nextId, scale }, null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mathora-geometry.json";
    a.click();
    URL.revokeObjectURL(url);
    say("فایل پروژه دانلود شد.");
  });

  $("zoomIn").addEventListener("click", () => {
    scale = Math.min(150, scale * 1.2);
    draw();
    saveLocal();
  });

  $("zoomOut").addEventListener("click", () => {
    scale = Math.max(8, scale / 1.2);
    draw();
    saveLocal();
  });

  $("fitBtn").addEventListener("click", () => {
    ox = W / 2;
    oy = H / 2;
    scale = 40;
    draw();
  });

  document.addEventListener("keydown", event => {
    const typing = event.target instanceof HTMLInputElement && event.target.type !== "checkbox";

    if (event.key === "Enter" && tool === "polygon" && !typing) finishPolygon();
    if ((event.key === "Delete" || event.key === "Backspace") && !typing) {
      event.preventDefault();
      deleteSelected();
    }
    if (event.key === "Escape") {
      pending = [];
      polygonIds = [];
      say("عملیات جاری لغو شد.");
      draw();
    }
  });

  /* ---------- command box ---------- */

  function command(text) {
    const parts = text.trim().toLowerCase().split(/[\s,;]+/);
    const name = parts[0];
    const n = Number(parts[1]);
    const m = Number(parts[2]);

    if (name === "segment" && Number.isFinite(n) && n > 0) {
      transact(() => {
        const a = createPoint(screenToWorld(W * .30, H * .55));
        const b = createPoint({ x: a.x + n, y: a.y });
        addObject({ type: "segment", a: a.id, b: b.id });
      });
      say(`پاره‌خط با طول ${n} ساخته شد.`);
    } else if (name === "circle" && Number.isFinite(n) && n > 0) {
      transact(() => {
        const c = createPoint(screenToWorld(W / 2, H / 2));
        const edge = createPoint({ x: c.x + n, y: c.y });
        addObject({ type: "circle", center: c.id, through: edge.id, radius: n });
      });
      say(`دایره با شعاع ${n} ساخته شد.`);
    } else if (name === "point" && Number.isFinite(n) && Number.isFinite(m)) {
      transact(() => createPoint({ x: n, y: m }));
      say(`نقطهٔ (${n}, ${m}) ساخته شد.`);
    } else if (name === "triangle") {
      transact(() => {
        const a = createPoint({ x: -3, y: -2 });
        const b = createPoint({ x: 3, y: -2 });
        const c = createPoint({ x: 0, y: 3 });
        addObject({ type: "polygon", points: [a.id, b.id, c.id] });
      });
      say("مثلث ساخته شد.");
    } else if (name === "rectangle" && Number.isFinite(n) && Number.isFinite(m) && n > 0 && m > 0) {
      transact(() => {
        const a = createPoint({ x: -n / 2, y: -m / 2 });
        const b = createPoint({ x: n / 2, y: -m / 2 });
        const c = createPoint({ x: n / 2, y: m / 2 });
        const d = createPoint({ x: -n / 2, y: m / 2 });
        addObject({ type: "polygon", points: [a.id, b.id, c.id, d.id] });
      });
      say(`مستطیل ${n} در ${m} ساخته شد.`);
    } else if (name === "regular" && Number.isInteger(n) && n >= 3 && n <= 24) {
      const r = m > 0 ? m : 3;
      transact(() => {
        const ids = [];
        for (let k = 0; k < n; k++) {
          const t = Math.PI / 2 + 2 * Math.PI * k / n;
          ids.push(createPoint({ x: r * Math.cos(t), y: r * Math.sin(t) }).id);
        }
        addObject({ type: "polygon", points: ids });
      });
      say(`چندضلعی منتظم ${n} ضلعی با شعاع ${r} ساخته شد.`);
    } else if (name === "pythagoras") {
      const a = n > 0 ? n : 3, b = m > 0 ? m : 4;
      transact(() => {
        const A = createPoint({ x: 0, y: 0 });
        const B = createPoint({ x: a, y: 0 });
        const C = createPoint({ x: 0, y: b });
        const D = createPoint({ x: a, y: -a });
        const E = createPoint({ x: 0, y: -a });
        const F = createPoint({ x: -b, y: b });
        const G = createPoint({ x: -b, y: 0 });
        const H = createPoint({ x: b, y: a + b });
        const I = createPoint({ x: a + b, y: a });
        addObject({ type: "polygon", points: [A.id, B.id, D.id, E.id] });
        addObject({ type: "polygon", points: [A.id, G.id, F.id, C.id] });
        addObject({ type: "polygon", points: [B.id, I.id, H.id, C.id] });
        addObject({ type: "polygon", points: [A.id, B.id, C.id] });
        addObject({ type: "angle", a: B.id, vertex: A.id, c: C.id });
      });
      say(`قضیهٔ فیثاغورس: ${fmt(a * a)} + ${fmt(b * b)} = ${fmt(a * a + b * b)} ← وتر = ${fmt(Math.hypot(a, b))}`);
    } else {
      say("دستورها: segment 13 · circle 5 · triangle · rectangle 8 5 · point 3 4 · regular 6 3 · pythagoras 3 4");
    }
  }

  $("commandForm").addEventListener("submit", event => {
    event.preventDefault();
    command($("commandInput").value);
    $("commandInput").value = "";
  });

  document.querySelectorAll("[data-command]").forEach(button =>
    button.addEventListener("click", () => command(button.dataset.command)));

  /* ---------- startup ---------- */

  try {
    const data = JSON.parse(localStorage.getItem("SAM MATH_GEOMETRY_STUDIO") || "null");
    if (data && Array.isArray(data.objects)) {
      objects = data.objects;
      nextId = data.nextId || objects.reduce((max, o) => Math.max(max, o.id), 0) + 1;
      if (Number.isFinite(data.scale)) scale = data.scale;
    }
  } catch (_) {}

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(shell);
  } else {
    window.addEventListener("resize", resize);
  }

  setTool("select");
  resize();
})();
