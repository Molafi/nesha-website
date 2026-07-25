/* ==========================================================================
   TERRA — scene.js
   Three.js 3D terrain of the Jordanian land subdivision.
   Recreates the reference map: sandy desert base, numbered plot parcels,
   stone walls, olive trees, a curving road, dashed parcel boundaries,
   floating Arabic street labels, warm desert light, dust motes + fog.

   Exposes window.TerraScene with methods used by scroll.js (GSAP) and the
   listing detail mini-map.
   ========================================================================== */
(function () {
  'use strict';

  const PAL = {
    sand: 0xC8A96E,
    sandLight: 0xD8BD86,
    earth: 0x8B5E3C,
    wadi: 0x2C4A3E,
    gold: 0xD4A017,
    stone: 0xC9B79A,
    fog: 0xF5E6C8,
    green: 0x6FA86A,
    trunk: 0x6b4a2f,
  };

  // Default plot layout matching the seeded parcels (id → grid position).
  // Overridden by real data via setPlots().
  const DEFAULT_PLOTS = [
    { id: 1, num: 1, x: -14, z: -9, w: 7, d: 7, status: 'Available' },
    { id: 2, num: 2, x: -6, z: -9, w: 7, d: 7, status: 'Available' },
    { id: 3, num: 3, x: 2, z: -9, w: 7, d: 7, status: 'Reserved' },
    { id: 4, num: 4, x: 11, z: -9, w: 8, d: 7, status: 'Available' },
    { id: 5, num: 5, x: -10, z: 2, w: 9, d: 8, status: 'Available' },
    { id: 6, num: 6, x: -2, z: 2, w: 6, d: 8, status: 'Sold' },
    { id: 7, num: 7, x: 6, z: 2, w: 7, d: 8, status: 'Available' },
    { id: 8, num: 8, x: 14, z: 2, w: 7, d: 8, status: 'Available' },
    { id: 9, num: 9, x: 0, z: 12, w: 9, d: 6, status: 'Available' },
  ];

  const STATUS_COLOR = {
    Available: 0x6FA86A,
    Reserved: PAL.gold,
    Sold: PAL.earth,
  };

  function hasThree() { return typeof window.THREE !== 'undefined'; }

  // ---- Text sprite (used for Arabic street labels + plot numbers) --------
  function makeTextSprite(text, opts = {}) {
    const {
      font = '600 64px "Noto Naskh Arabic", "Playfair Display", serif',
      color = '#2C1810', bg = 'rgba(245,230,200,0.92)', pad = 28,
      border = '#8B5E3C', rtl = false, scale = 1,
    } = opts;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const tw = Math.ceil(metrics.width) + pad * 2;
    const th = 92 + pad;
    canvas.width = tw; canvas.height = th;
    const c = canvas.getContext('2d');
    c.font = font;
    c.direction = rtl ? 'rtl' : 'ltr';
    // pill background
    c.fillStyle = bg;
    roundRect(c, 4, 4, tw - 8, th - 8, 16); c.fill();
    if (border) { c.lineWidth = 3; c.strokeStyle = border; roundRect(c, 4, 4, tw - 8, th - 8, 16); c.stroke(); }
    c.fillStyle = color;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, tw / 2, th / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    const aspect = tw / th;
    sprite.scale.set(6 * aspect * scale, 6 * scale, 1);
    return sprite;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Procedural sandy texture (canvas) ---------------------------------
  function sandTexture() {
    const s = 512;
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#C8A96E'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const a = Math.random() * 0.06;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(120,80,50,${a})` : `rgba(255,240,210,${a})`;
      ctx.fillRect(x, y, 2, 2);
    }
    // faint contour striations (wadi feel)
    ctx.strokeStyle = 'rgba(120,80,50,0.05)';
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 60, s * 0.6, y + (Math.random() - 0.5) * 60, s, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    return tex;
  }

  // ---- Wind-line shader background plane ---------------------------------
  function windShaderMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(PAL.sandLight) } },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
        float line(float y, float off, float w){ return smoothstep(w, 0.0, abs(fract(y+off)-0.5)); }
        void main(){
          float u = vUv.x; float v = vUv.y;
          float streak = 0.0;
          streak += line(v*6.0, uTime*0.05, 0.02) * 0.5;
          streak += line(v*10.0, -uTime*0.03, 0.015) * 0.35;
          float fade = smoothstep(0.0,0.3,u) * smoothstep(1.0,0.7,u);
          gl_FragColor = vec4(uColor, streak*fade*0.18);
        }
      `,
    });
  }

  // =======================================================================
  // Main Scene class
  // =======================================================================
  function TerraSceneFactory() {
    let renderer, scene, camera, controls, clock;
    let raf = null;
    let plotGroup, plots = {}, dust, windMat;
    let envGroup, birds = [], clouds = [];
    let mounted = false;
    let autoRotate = true;
    let reducedMotion = false;
    let opts = {};
    let interacting = false, idleTimer = null;

    function init(canvas, options = {}) {
      opts = options;
      if (!hasThree()) { drawFallback(canvas); return false; }
      reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const w = canvas.clientWidth || canvas.parentElement.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight || window.innerHeight;

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      renderer.shadowMap.enabled = !options.mini;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(PAL.fog, options.mini ? 60 : 80, options.mini ? 160 : 200);

      camera = new THREE.PerspectiveCamera(options.mini ? 45 : 52, w / h, 0.1, 1000);
      const startCam = options.startCam || (options.mini ? { x: 0, y: 40, z: 34 } : { x: 0, y: 46, z: 52 });
      camera.position.set(startCam.x, startCam.y, startCam.z);
      camera.lookAt(0, 0, 0);

      clock = new THREE.Clock();

      buildLights();
      buildGround();
      buildRoad();
      buildBoundaries();
      buildLabels();
      buildHorizon();      // distant low-poly mountain ring
      buildEnvironment();  // scattered groves, bushes, boulders (background)
      buildSky();          // sun disk + drifting clouds
      buildBirds();        // slow flying birds
      buildDust();
      buildWind();

      plotGroup = new THREE.Group();
      scene.add(plotGroup);
      setPlots(options.plots || DEFAULT_PLOTS);

      // Controls
      const isTouch = window.matchMedia('(pointer: coarse)').matches;
      if (window.THREE.OrbitControls) {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 12;
        controls.maxDistance = 120;
        controls.maxPolarAngle = Math.PI * 0.49;
        controls.enablePan = false;
        controls.enabled = options.controls !== false && !isTouch; // disabled on touch per brief
        controls.target.set(0, 0, 0);
        controls.addEventListener('start', () => { interacting = true; autoRotate = false; });
        controls.addEventListener('end', () => {
          interacting = false;
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { if (!options.mini) autoRotate = true; }, 3500);
        });
      }
      autoRotate = options.autoRotate !== false && !reducedMotion;

      mounted = true;
      window.addEventListener('resize', onResize);
      onResize();
      animate();
      return true;
    }

    function drawFallback(canvas) {
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width = canvas.clientWidth; const h = canvas.height = canvas.clientHeight;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#F5E6C8'); g.addColorStop(1, '#8B5E3C');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(44,24,16,.4)'; ctx.font = '600 20px serif';
      ctx.textAlign = 'center'; ctx.fillText('TERRA · terrain preview', w / 2, h / 2);
    }

    function buildLights() {
      scene.add(new THREE.HemisphereLight(0xFDF3DC, PAL.earth, 0.85));
      const amb = new THREE.AmbientLight(0xF5E6C8, 0.45); scene.add(amb);
      const sun = new THREE.DirectionalLight(0xFFE3B0, 1.15);
      sun.position.set(40, 55, 30); // upper-right
      sun.castShadow = !opts.mini;
      if (sun.shadow) {
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
        sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
        sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
      }
      scene.add(sun);
    }

    function buildGround() {
      const geo = new THREE.PlaneGeometry(240, 240, 64, 64);
      // subtle undulation for wadi geography
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const d = Math.sqrt(x * x + y * y);
        const z = Math.sin(x * 0.06) * Math.cos(y * 0.05) * 1.4 - Math.max(0, (d - 70) * 0.08);
        pos.setZ(i, z);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ map: sandTexture(), color: 0xffffff, roughness: 1, metalness: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // Curving road via TubeGeometry along a bezier curve (matches image)
    function buildRoad() {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-30, 0.15, -3),
        new THREE.Vector3(-14, 0.15, -3.5),
        new THREE.Vector3(2, 0.15, -3),
        new THREE.Vector3(20, 0.15, -2),
        new THREE.Vector3(28, 0.15, 6),
        new THREE.Vector3(20, 0.15, 16),
        new THREE.Vector3(2, 0.15, 18),
        new THREE.Vector3(-18, 0.15, 16),
      ]);
      const geo = new THREE.TubeGeometry(curve, 120, 1.6, 8, false);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9c8358, roughness: .95 });
      const road = new THREE.Mesh(geo, mat);
      road.receiveShadow = true;
      // flatten the tube into a ribbon-ish road
      road.scale.y = 0.12;
      road.position.y = 0.05;
      scene.add(road);

      // secondary internal 12m street
      const curve2 = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-20, 0.14, 7),
        new THREE.Vector3(-4, 0.14, 7.5),
        new THREE.Vector3(12, 0.14, 7),
        new THREE.Vector3(22, 0.14, 7.5),
      ]);
      const geo2 = new THREE.TubeGeometry(curve2, 60, 1.0, 8, false);
      const road2 = new THREE.Mesh(geo2, mat.clone());
      road2.scale.y = 0.12; road2.position.y = 0.05; road2.receiveShadow = true;
      scene.add(road2);

      // center dashes on main road
      const pts = curve.getPoints(120);
      const dashGeo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 0.28, p.z)));
      const dashMat = new THREE.LineDashedMaterial({ color: 0xF0E8D8, dashSize: 1.2, gapSize: 1.0, transparent: true, opacity: .7 });
      const dashed = new THREE.Line(dashGeo, dashMat);
      dashed.computeLineDistances();
      scene.add(dashed);
    }

    // Dashed parcel boundary rectangles for registry numbers 2372/2373/1870/165
    function buildBoundaries() {
      const rects = [
        { x: -14, z: -9, w: 7, d: 7 }, { x: -6, z: -9, w: 7, d: 7 },
        { x: 2, z: -9, w: 7, d: 7 }, { x: 11, z: -9, w: 8, d: 7 },
        { x: -10, z: 2, w: 9, d: 8 }, { x: 6, z: 2, w: 7, d: 8 },
      ];
      rects.forEach((r) => {
        const hw = r.w / 2 + 0.6, hd = r.d / 2 + 0.6;
        const pts = [
          new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd),
          new THREE.Vector3(hw, 0, hd), new THREE.Vector3(-hw, 0, hd),
          new THREE.Vector3(-hw, 0, -hd),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineDashedMaterial({ color: PAL.earth, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: .55 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.position.set(r.x, 0.3, r.z);
        scene.add(line);
      });
    }

    function buildLabels() {
      // Arabic street labels floating above the roads
      const l1 = makeTextSprite('شارع ٢٠ متر', { rtl: true, color: '#2C1810', border: '#8B5E3C' });
      l1.position.set(-6, 5.5, -3);
      scene.add(l1);
      const l2 = makeTextSprite('شارع ١٢ متر', { rtl: true, color: '#2C4A3E', border: '#8B5E3C' });
      l2.position.set(4, 4.5, 7);
      l2.scale.multiplyScalar(0.85);
      scene.add(l2);
    }

    function oliveTree(x, z, s = 1) {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 1.4 * s, 6),
        new THREE.MeshStandardMaterial({ color: PAL.trunk, roughness: 1 })
      );
      trunk.position.y = 0.7 * s; trunk.castShadow = true;
      g.add(trunk);
      const foliageMat = new THREE.MeshStandardMaterial({ color: PAL.green, roughness: 1, flatShading: true });
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry((1.1 - i * 0.25) * s, (1.3 - i * 0.15) * s, 7), foliageMat);
        cone.position.y = (1.3 + i * 0.6) * s; cone.castShadow = true;
        g.add(cone);
      }
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * Math.PI;
      return g;
    }

    // Stone wall (thin extruded box) between two points
    function stoneWall(x1, z1, x2, z2) {
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      const geo = new THREE.BoxGeometry(len, 0.7, 0.35);
      const mat = new THREE.MeshStandardMaterial({ color: PAL.stone, roughness: 1, flatShading: true });
      const wall = new THREE.Mesh(geo, mat);
      wall.castShadow = true; wall.receiveShadow = true;
      wall.position.set((x1 + x2) / 2, 0.35, (z1 + z2) / 2);
      wall.rotation.y = -Math.atan2(dz, dx);
      return wall;
    }

    // ---- Additional vegetation for a lush landscape ---------------------
    // Tall, slender cypress — a signature of the Jordanian/Levantine hills.
    function cypressTree(x, z, s = 1) {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08 * s, 0.14 * s, 0.9 * s, 6),
        new THREE.MeshStandardMaterial({ color: PAL.trunk, roughness: 1 })
      );
      trunk.position.y = 0.45 * s; trunk.castShadow = true; g.add(trunk);
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.7 * s, 4.2 * s, 8),
        new THREE.MeshStandardMaterial({ color: 0x3f6b46, roughness: 1, flatShading: true })
      );
      body.position.y = 2.7 * s; body.castShadow = true; g.add(body);
      g.position.set(x, 0, z);
      return g;
    }

    // Date palm — trunk with a radiating crown of frond blades.
    function palmTree(x, z, s = 1) {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 3.4 * s, 7),
        new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 })
      );
      trunk.position.y = 1.7 * s; trunk.castShadow = true; g.add(trunk);
      const frondMat = new THREE.MeshStandardMaterial({ color: 0x5f9457, roughness: 1, side: THREE.DoubleSide, flatShading: true });
      const fronds = 7;
      for (let i = 0; i < fronds; i++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.35 * s, 2.4 * s, 4), frondMat);
        const a = (i / fronds) * Math.PI * 2;
        frond.position.set(Math.cos(a) * 1.0 * s, 3.4 * s, Math.sin(a) * 1.0 * s);
        frond.rotation.z = Math.PI / 2.2;
        frond.rotation.y = -a;
        frond.castShadow = true;
        g.add(frond);
      }
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * Math.PI;
      return g;
    }

    // Low desert shrub — a cluster of rough green lumps.
    function bush(x, z, s = 1) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b8f52, roughness: 1, flatShading: true });
      const lumps = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < lumps; i++) {
        const r = (0.4 + Math.random() * 0.35) * s;
        const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
        lump.position.set((Math.random() - 0.5) * 0.9 * s, r * 0.8, (Math.random() - 0.5) * 0.9 * s);
        lump.castShadow = true;
        g.add(lump);
      }
      g.position.set(x, 0, z);
      return g;
    }

    // Weathered boulder — faceted stone.
    function boulder(x, z, s = 1) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry((0.6 + Math.random() * 0.7) * s, 0),
        new THREE.MeshStandardMaterial({ color: 0xb7a382, roughness: 1, flatShading: true })
      );
      rock.position.set(x, 0.25 * s, z);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      rock.scale.y = 0.7;
      rock.castShadow = true; rock.receiveShadow = true;
      return rock;
    }

    // Approx height of the undulating ground at (x,z) so props sit on it.
    function groundHeight(x, z) {
      const d = Math.sqrt(x * x + z * z);
      return Math.sin(x * 0.06) * Math.cos(z * 0.05) * 1.4 - Math.max(0, (d - 70) * 0.08);
    }

    // Is this point clear of the central plot/road area?
    function inPlotZone(x, z) {
      return (x > -22 && x < 22 && z > -15 && z < 20);
    }

    // Scatter a lush landscape in a ring AROUND the subdivision.
    function buildEnvironment() {
      envGroup = new THREE.Group();
      const count = opts.mini ? 60 : 240;
      let placed = 0, guard = 0;
      while (placed < count && guard < count * 8) {
        guard++;
        const ang = Math.random() * Math.PI * 2;
        const rad = 24 + Math.random() * 74;           // ring: outside the plots
        const x = Math.cos(ang) * rad + (Math.random() - 0.5) * 8;
        const z = Math.sin(ang) * rad + (Math.random() - 0.5) * 8;
        if (inPlotZone(x, z)) continue;
        const y = groundHeight(x, z);
        const near = rad < 44;
        const roll = Math.random();
        let prop;
        if (roll < 0.42) prop = oliveTree(x, z, 0.7 + Math.random() * 0.6);
        else if (roll < 0.66) prop = cypressTree(x, z, 0.8 + Math.random() * 0.7);
        else if (roll < 0.78) prop = palmTree(x, z, 0.7 + Math.random() * 0.5);
        else if (roll < 0.92) prop = bush(x, z, 0.8 + Math.random() * 0.8);
        else prop = boulder(x, z, 0.8 + Math.random() * 0.9);
        prop.position.y += y;
        // Only let nearer props cast shadows (shadow camera is finite + perf).
        if (!near) prop.traverse((c) => { if (c.isMesh) c.castShadow = false; });
        envGroup.add(prop);
        placed++;
      }
      scene.add(envGroup);
    }

    // Distant low-poly mountain ring on the horizon for depth.
    function buildHorizon() {
      const grp = new THREE.Group();
      const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xb99a6a, roughness: 1, flatShading: true });
      const farMat = new THREE.MeshStandardMaterial({ color: 0xcbb287, roughness: 1, flatShading: true });
      const N = opts.mini ? 18 : 46;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + Math.random() * 0.12;
        const far = Math.random() > 0.5;
        const rad = far ? 128 + Math.random() * 26 : 108 + Math.random() * 16;
        const h = (far ? 12 : 18) + Math.random() * 22;
        const r = 10 + Math.random() * 16;
        const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + Math.floor(Math.random() * 3)), far ? farMat : ridgeMat);
        m.position.set(Math.cos(a) * rad, h / 2 - 4, Math.sin(a) * rad);
        m.rotation.y = Math.random() * Math.PI;
        grp.add(m);
      }
      scene.add(grp);
    }

    // A glowing sun disk plus soft drifting clouds.
    function buildSky() {
      // Sun disk aligned with the directional sun light (upper-right).
      const sunCanvas = document.createElement('canvas');
      sunCanvas.width = sunCanvas.height = 128;
      const sc = sunCanvas.getContext('2d');
      const grad = sc.createRadialGradient(64, 64, 6, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,246,214,1)');
      grad.addColorStop(0.35, 'rgba(255,221,150,0.95)');
      grad.addColorStop(1, 'rgba(255,221,150,0)');
      sc.fillStyle = grad; sc.fillRect(0, 0, 128, 128);
      const sunTex = new THREE.CanvasTexture(sunCanvas);
      const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false }));
      const sd = new THREE.Vector3(40, 55, 30).normalize().multiplyScalar(150);
      sun.position.copy(sd);
      sun.scale.set(48, 48, 1);
      scene.add(sun);

      // Clouds — clusters of flattened white spheres drifting slowly.
      const cloudMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 1, transparent: true, opacity: 0.85, fog: true });
      const cN = opts.mini ? 3 : 8;
      for (let i = 0; i < cN; i++) {
        const cloud = new THREE.Group();
        const puffs = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < puffs; j++) {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(2.4 + Math.random() * 2.2, 8, 8), cloudMat);
          puff.position.set(j * 3 - puffs, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 2);
          puff.scale.y = 0.55;
          cloud.add(puff);
        }
        const ang = Math.random() * Math.PI * 2;
        const rad = 55 + Math.random() * 45;
        cloud.position.set(Math.cos(ang) * rad, 34 + Math.random() * 16, Math.sin(ang) * rad);
        cloud.userData.speed = 0.4 + Math.random() * 0.6;
        clouds.push(cloud);
        scene.add(cloud);
      }
    }

    // Simple V-shaped birds gliding in wide circles overhead.
    function buildBirds() {
      const N = opts.mini ? 0 : 7;
      const mat = new THREE.LineBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.8, fog: true });
      for (let i = 0; i < N; i++) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-1.1, 0.5, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.1, 0.5, 0),
        ]);
        const bird = new THREE.Line(geo, mat);
        bird.userData = {
          radius: 30 + Math.random() * 45,
          angle: Math.random() * Math.PI * 2,
          speed: 0.12 + Math.random() * 0.14,
          height: 24 + Math.random() * 16,
          phase: Math.random() * Math.PI * 2,
        };
        birds.push(bird);
        scene.add(bird);
      }
    }

    function setPlots(list) {
      // clear
      while (plotGroup.children.length) plotGroup.remove(plotGroup.children[0]);
      plots = {};
      const source = (list && list.length) ? list : DEFAULT_PLOTS;

      source.forEach((p, idx) => {
        const gx = (p.map_x != null ? p.map_x : (p.x != null ? p.x : (idx % 4) * 8 - 12));
        const gz = (p.map_z != null ? p.map_z : (p.z != null ? p.z : Math.floor(idx / 4) * 11 - 5));
        const w = p.w || 7, d = p.d || 7;
        const status = p.status || 'Available';
        const num = p.num || (p.parcel_number && (p.parcel_number.match(/Plot\s*(\d+)/i) || [])[1]) || (idx + 1);

        const grp = new THREE.Group();
        grp.position.set(gx, 0, gz);

        // raised parcel box
        const boxGeo = new THREE.BoxGeometry(w, 1.2, d);
        const boxMat = new THREE.MeshStandardMaterial({ color: PAL.sandLight, roughness: .9, metalness: 0 });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.y = 0.6; box.castShadow = true; box.receiveShadow = true;
        grp.add(box);

        // glowing outline (edges)
        const edges = new THREE.EdgesGeometry(boxGeo);
        const glowColor = STATUS_COLOR[status] || PAL.gold;
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: glowColor, transparent: true, opacity: .9 }));
        line.position.y = 0.6;
        grp.add(line);

        // top glow plate
        const plate = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.92, d * 0.92),
          new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: .12 })
        );
        plate.rotation.x = -Math.PI / 2; plate.position.y = 1.22;
        grp.add(plate);

        // plot number sprite
        const label = makeTextSprite(String(num), {
          font: '800 72px "Playfair Display", serif', bg: 'rgba(26,18,8,0.85)',
          color: '#D4A017', border: '#D4A017', scale: 0.6,
        });
        label.position.set(0, 3.2, 0);
        grp.add(label);

        // olive trees + a stone wall edge for character
        grp.add(oliveTree(w / 2 - 1, d / 2 - 1, 0.8));
        if (idx % 2 === 0) grp.add(oliveTree(-w / 2 + 1, -d / 2 + 1, 0.7));
        grp.add(stoneWall(-w / 2, d / 2, w / 2, d / 2));

        grp.userData = { id: p.id, num, status, baseY: 0, targetY: 0 };
        // start slightly sunken for the rise animation
        grp.position.y = 0;
        plotGroup.add(grp);
        plots[p.id != null ? p.id : num] = grp;
      });
    }

    function buildDust() {
      const count = opts.mini ? 120 : 420;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const speeds = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 160;
        pos[i * 3 + 1] = Math.random() * 40;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
        speeds[i] = 0.4 + Math.random() * 1.2;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xFFF6E0, size: 0.35, transparent: true, opacity: .6, depthWrite: false });
      dust = new THREE.Points(geo, mat);
      dust.userData.speeds = speeds;
      scene.add(dust);
    }

    function buildWind() {
      const geo = new THREE.PlaneGeometry(300, 120);
      windMat = windShaderMaterial();
      const mesh = new THREE.Mesh(geo, windMat);
      mesh.position.set(0, 30, -90);
      scene.add(mesh);
    }

    function onResize() {
      if (!renderer) return;
      const canvas = renderer.domElement;
      const parent = canvas.parentElement;
      const w = parent.clientWidth, h = parent.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();

      if (dust) {
        const p = dust.geometry.attributes.position;
        const sp = dust.userData.speeds;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) + sp[i] * dt * 1.6;
          if (y > 42) y = 0;
          p.setY(i, y);
          p.setX(i, p.getX(i) + Math.sin(t * 0.2 + i) * 0.003);
        }
        p.needsUpdate = true;
      }
      if (windMat) windMat.uniforms.uTime.value = t;

      // Drift clouds slowly across the sky; wrap them around the ring.
      for (const cloud of clouds) {
        cloud.position.x += cloud.userData.speed * dt * 2.2;
        if (cloud.position.x > 110) cloud.position.x = -110;
      }

      // Birds glide in wide circles with a gentle wing flap + bob.
      if (!reducedMotion) {
        for (const bird of birds) {
          const u = bird.userData;
          u.angle += u.speed * dt;
          bird.position.set(
            Math.cos(u.angle) * u.radius,
            u.height + Math.sin(t * 0.6 + u.phase) * 1.6,
            Math.sin(u.angle) * u.radius
          );
          bird.rotation.y = -u.angle + Math.PI / 2;
          const flap = 0.4 + Math.abs(Math.sin(t * 6 + u.phase)) * 0.5;
          bird.scale.set(1, flap, 1);
        }
      }

      // gently bob plot number labels + pulse glow
      if (!reducedMotion) {
        Object.values(plots).forEach((g, i) => {
          const plate = g.children.find(c => c.material && c.material.opacity != null && c.geometry && c.geometry.type === 'PlaneGeometry');
          if (plate) plate.material.opacity = 0.08 + Math.abs(Math.sin(t * 1.2 + i)) * 0.12;
        });
      }

      if (controls) {
        if (autoRotate && !interacting) {
          // rotate camera around target
          const r = Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2);
          const a = Math.atan2(camera.position.z, camera.position.x) + dt * 0.06;
          camera.position.x = Math.cos(a) * r;
          camera.position.z = Math.sin(a) * r;
          camera.lookAt(controls.target);
        }
        controls.update();
      }
      renderer.render(scene, camera);
    }

    // ---- Public API used by GSAP scroll + detail mini-map ----------------
    function getCamera() { return camera; }
    function getControls() { return controls; }
    function setAutoRotate(v) { autoRotate = v; }
    function raiseAll(progress) {
      // progress 0..1 → plots rise from ground with per-plot stagger
      const ids = Object.keys(plots);
      ids.forEach((id, i) => {
        const stagger = i / ids.length;
        let local = (progress - stagger * 0.5) / (1 - stagger * 0.5 + 0.001);
        local = Math.max(0, Math.min(1, local));
        const eased = 1 - Math.pow(1 - local, 3);
        plots[id].position.y = -6 + eased * 6; // from sunken to ground
        plots[id].traverse((c) => { if (c.material && c.material.transparent === false) c.material.opacity = eased; });
      });
    }
    function setPlotY(id, y) { if (plots[id]) plots[id].position.y = y; }
    let marker = null;
    function setMarker(x, z) {
      if (!scene) return;
      if (!marker) {
        marker = new THREE.Group();
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(1.1, 3, 12),
          new THREE.MeshStandardMaterial({ color: PAL.gold, emissive: 0x5a4300, roughness: .4 })
        );
        cone.rotation.x = Math.PI; cone.position.y = 4;
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.6, 16, 16),
          new THREE.MeshBasicMaterial({ color: PAL.gold })
        );
        ball.position.y = 5.6;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.4, 1.9, 24),
          new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: .6, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.4;
        marker.add(cone); marker.add(ball); marker.add(ring);
        scene.add(marker);
      }
      marker.position.set(x, 0, z);
      marker.visible = true;
    }
    function clearMarker() { if (marker) marker.visible = false; }
    function highlight(id) {
      Object.entries(plots).forEach(([pid, g]) => {
        const isTarget = String(pid) === String(id);
        g.traverse((c) => {
          if (c.type === 'LineSegments') { c.material.opacity = isTarget ? 1 : 0.15; }
        });
        if (!isTarget) { g.position.y = -0.3; }
        else {
          g.position.y = 0.4;
          // frame camera on this plot
          if (camera) {
            camera.position.set(g.position.x + 10, 14, g.position.z + 14);
            camera.lookAt(g.position.x, 0, g.position.z);
            if (controls) controls.target.set(g.position.x, 0, g.position.z);
          }
        }
      });
    }
    function plotScreenPositions() {
      // returns map id → {x,y,visible} in normalized screen coords (for floating cards)
      const out = {};
      if (!camera) return out;
      const v = new THREE.Vector3();
      Object.entries(plots).forEach(([id, g]) => {
        v.set(g.position.x, g.position.y + 2, g.position.z);
        v.project(camera);
        out[id] = { x: (v.x * 0.5 + 0.5), y: (-v.y * 0.5 + 0.5), visible: v.z < 1 };
      });
      return out;
    }
    function dispose() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (renderer) { renderer.dispose(); }
      mounted = false;
    }

    return {
      init, setPlots, getCamera, getControls, setAutoRotate,
      raiseAll, setPlotY, highlight, plotScreenPositions, dispose,
      setMarker, clearMarker,
      isMounted: () => mounted, hasThree,
      PAL,
    };
  }

  window.TerraScene = TerraSceneFactory();
  window.TerraSceneFactory = TerraSceneFactory; // for mini-maps / multiple instances
})();
