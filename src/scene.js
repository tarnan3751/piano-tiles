// three.js scene: neon highway that comes alive with the player's energy.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const LANE_W = 1.7;
export const LANES = 4;
export const laneX = (l) => (l - 1.5) * LANE_W;
const MAX_TILES = 160, MAX_PARTICLES = 420, MAX_SHARDS = 220, TOWERS_PER_SIDE = 26, MAX_HITS = 10;
const PILL_W = 1.3, PILL_D = 0.6, PILL_R = 0.24;   // plan size of the base pill (length grows in the vertex shader)
const DECAL_PAD = 0.9;

// ---------- shaders ----------
const ROAD_VERT = /* glsl */`
  uniform float uTime; uniform vec4 uHits[${MAX_HITS}];
  varying vec2 vXZ; varying float vRipple;
  #include <fog_pars_vertex>
  void main(){
    vec3 p = position; vXZ = p.xz; float r = 0.0;
    for (int i = 0; i < ${MAX_HITS}; i++) {
      vec4 h = uHits[i]; if (h.w == 0.0) continue;
      float age = uTime - h.z; if (age < 0.0 || age > 2.2) continue;
      float d = distance(p.xz, h.xy);
      float ring = h.w > 0.0 ? exp(-pow((d - age * 7.0) / 0.45, 2.0)) * exp(-age * 2.2) * h.w : exp(-pow((d - age * 9.0) / 0.28, 2.0)) * exp(-age * 4.0) * -h.w;
      r += h.w > 0.0 ? ring : -ring;
    }
    r = clamp(r, -1.3, 1.3); vRipple = r; p.y += r * 0.12;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const ROAD_FRAG = /* glsl */`
  uniform float uScroll; uniform float uEnergy; uniform float uLaneW; uniform float uWidth; uniform vec3 uHue; uniform float uLane[4];
  varying vec2 vXZ; varying float vRipple;
  #include <fog_pars_fragment>
  float line(float v, float w){ float f = abs(fract(v) - 0.5); return smoothstep(0.5 - w, 0.5, f); }
  void main(){
    float e = uEnergy;
    vec3 base = mix(vec3(0.015, 0.01, 0.035), vec3(0.05, 0.015, 0.09), e);
    float lanes = line(vXZ.x / uLaneW + 0.5, 0.045 + 0.02 * e);
    float rows = line((vXZ.y - uScroll) / 2.4, 0.03 + 0.015 * e);  // rows travel toward the camera, with the tiles
    float edge = smoothstep(uWidth * 0.5 - 0.12, uWidth * 0.5, abs(vXZ.x));
    vec3 gridCol = mix(vec3(0.25, 0.05, 0.5), vec3(0.95, 0.2, 0.75), e);
    vec3 rowCol = mix(vec3(0.1, 0.2, 0.45), vec3(0.2, 0.9, 1.0), e);
    float dist = clamp(-vXZ.y / 90.0, 0.0, 1.0);
    vec3 col = base + gridCol * lanes * (0.45 + 0.6 * e) + rowCol * rows * (0.25 + 0.55 * e) * (1.0 - dist * 0.6);
    col += vec3(1.0, 0.3, 0.9) * edge * (0.45 + 0.6 * e);
    // per-lane pulse: white flash on a hit, red flicker on a miss
    int li = int(clamp(floor(vXZ.x / uLaneW + 2.0), 0.0, 3.0));
    float pulse = uLane[li]; float nearCam = smoothstep(-26.0, 2.0, vXZ.y);
    vec3 pulseCol = pulse > 0.0 ? vec3(1.0, 0.95, 1.0) * pulse : vec3(0.95, 0.06, 0.12) * -pulse;
    col += pulseCol * (lanes * 1.1 + 0.07) * nearCam;
    // shockwave rings: coloured on a hit, a dark red dent on a miss
    col += vRipple > 0.0 ? uHue * vRipple * 0.35 : vec3(1.0, 0.05, 0.15) * (-vRipple) * 0.4;
    col = max(col, 0.0);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;
const PILL_VERT = /* glsl */`
  attribute vec4 aInst;
  varying vec2 vLocal; varying vec2 vHalf; varying vec3 vColor; varying vec4 vInst; varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main(){
    vec3 p = position; p.z += (p.z >= 0.0 ? 0.5 : -0.5) * aInst.z;  // stretch the pill along the road without distorting its rounded ends
    vLocal = p.xz; vHalf = vec2(${(PILL_W / 2).toFixed(3)}, ${(PILL_D / 2).toFixed(3)} + aInst.z * 0.5);
    vec4 wp = instanceMatrix * vec4(p, 1.0);
    vWorld = wp.xyz; vInst = aInst;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const PILL_FRAG = /* glsl */`
  uniform float uTime; uniform float uEnergy; uniform vec3 uSunDir; uniform float uR;
  varying vec2 vLocal; varying vec2 vHalf; varying vec3 vColor; varying vec4 vInst; varying vec3 vWorld;
  #include <fog_pars_fragment>
  float sdRoundRect(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main(){
    vec3 col = vColor; float state = vInst.x; float t = vInst.y;
    // exact face normal (no interpolation artifacts)
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    if (dot(n, viewDir) < 0.0) n = -n;
    float top = clamp(n.y, 0.0, 1.0);
    // rim: a band just inside the top outline, plus every bevel and wall face
    float d = sdRoundRect(vLocal, vHalf, uR);
    float rim = max(smoothstep(-0.17, -0.04, d), 1.0 - smoothstep(0.35, 0.8, top));
    float sunL = clamp(dot(n, uSunDir), 0.0, 1.0);
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
    float sheen = smoothstep(0.0, 0.08, 0.1 - abs(fract((vWorld.z * 0.35 + vWorld.x * 0.2) - uTime * 0.6) - 0.5));
    vec3 glass = vec3(0.03, 0.015, 0.07) + col * (0.2 + 0.12 * uEnergy) + col * sunL * (0.12 + 0.15 * uEnergy) + col * fres * 0.25 + col * sheen * 0.12;
    float near = t * step(state, 0.5);
    // hold pills: a brighter cap marks the head you press
    float head = (vInst.z > 0.4) ? smoothstep(vHalf.y - 0.5, vHalf.y - 0.12, vLocal.y) : 0.0;
    vec3 rimCol = col * (1.5 + 0.9 * near + 0.5 * uEnergy + 0.5 * head) + vec3(0.1) * near + vec3(0.08) * head;
    vec3 outCol = mix(glass, rimCol, max(rim, head * 0.45));
    float alpha = 1.0;
    if (state > 2.5) {                           // being held: the part that has passed the hit line burns white-hot
      float consumed = smoothstep(vInst.w - 0.08, vInst.w + 0.08, vLocal.y);
      float pulse = 0.85 + 0.15 * sin(uTime * 18.0);
      vec3 hot = col * 1.7 * pulse + vec3(0.22);
      outCol = mix(mix(glass, rimCol * 1.15, rim), hot, consumed);
      // a travelling shimmer up the unconsumed part
      float shimmer = smoothstep(0.0, 0.1, 0.12 - abs(fract(vLocal.y * 0.8 + uTime * 2.5) - 0.5)) * (1.0 - consumed) * 0.5;
      outCol += col * shimmer;
    } else if (state > 0.5 && state < 1.5) {    // hit: the whole pill flares, then fades
      outCol = mix(outCol, col * 2.6 + 0.3, 0.55 + 0.45 * rim); alpha = 1.0 - t;
    } else if (state >= 1.5) {                   // missed: dead glass with cracked red edges, sinking into the road
      float flick = 0.6 + 0.4 * step(0.5, fract(uTime * 11.0 + vWorld.x * 3.0));
      vec3 dead = col * 0.22 + vec3(0.06, 0.01, 0.02);
      outCol = mix(dead, vec3(0.85, 0.08, 0.12) * flick, rim * (1.0 - t * 0.5)); alpha = 1.0 - t * 0.95;
    }
    gl_FragColor = vec4(outCol, alpha);
    #include <fog_fragment>
  }`;
const DECAL_VERT = /* glsl */`
  attribute vec4 aInst; varying vec2 vUv; varying vec3 vColor; varying vec4 vInst;
  void main(){
    vUv = uv; vInst = aInst;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const DECAL_FRAG = /* glsl */`
  uniform float uEnergy; varying vec2 vUv; varying vec3 vColor; varying vec4 vInst;
  void main(){
    vec2 q = (vUv - 0.5) * 2.0; float d2 = dot(q, q); float g = exp(-d2 * 4.5);
    float state = vInst.x; float t = vInst.y; vec3 col; float a;
    if (state < 0.5) { float near = t; col = vColor * (0.6 + 1.0 * near + 0.3 * uEnergy); a = g * (0.3 + 0.5 * near); }
    else if (state < 1.5) { float ring = exp(-pow((sqrt(d2) - 0.15 - t * 1.0) / 0.22, 2.0)); col = vColor * 2.4 + 0.2; a = (g * 0.7 + ring * 1.0) * (1.0 - t); }
    else if (state < 2.5) { col = vec3(0.45, 0.02, 0.06); a = g * 0.9 * (1.0 - t * 0.7); }
    else { col = vColor * (1.6 + 0.4 * t); a = g * 0.85; }
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }`;
const SUN_FRAG = /* glsl */`
  uniform float uTime; uniform float uEnergy; uniform float uPulse; varying vec2 vUv;
  void main(){
    vec2 p = vUv - 0.5; float r = length(p) * 2.0;
    float disc = 1.0 - smoothstep(0.5, 0.515, r);
    float y = clamp((vUv.y - 0.25) / 0.5, 0.0, 1.0); float stripes = step(0.5 - 0.42 * (1.0 - y), fract(y * 14.0 - uTime * 0.15));
    stripes = mix(1.0, stripes, smoothstep(0.62, 0.35, y));
    vec3 top = mix(vec3(0.9, 0.25, 0.6), vec3(1.0, 0.75, 0.2), uEnergy);
    vec3 bot = mix(vec3(0.5, 0.05, 0.45), vec3(1.0, 0.2, 0.55), uEnergy);
    vec3 col = mix(bot, top, y) * disc * stripes * (0.42 + 0.2 * uEnergy + 0.1 * uPulse);
    float halo = pow(max(0.0, 1.0 - max(0.0, r - 0.5) / 0.5), 2.0 - 0.8 * uEnergy) * (0.08 + 0.18 * uEnergy + 0.1 * uPulse);
    col += mix(vec3(0.6, 0.1, 0.5), vec3(1.0, 0.4, 0.3), uEnergy) * halo;
    float a = max(disc * stripes, halo);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }`;
const FX_SHADER = {
  uniforms: { tDiffuse: { value: null }, uGlitch: { value: 0 }, uSat: { value: 1 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uGlitch; uniform float uSat; uniform float uTime; varying vec2 vUv;
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      float ab = 0.004 + uGlitch * 0.02;
      float shake = uGlitch * (fract(sin(uTime * 91.7) * 43758.5) - 0.5) * 0.01;
      uv.x += shake;
      vec3 col; col.r = texture2D(tDiffuse, uv + c * ab).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv - c * ab).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, uSat);
      float vig = smoothstep(0.95, 0.35, length(c) * 1.15); col *= 0.55 + 0.45 * vig;
      gl_FragColor = vec4(col, 1.0);
    }`
};

// Rounded slab with a bevelled top: a stadium-ish plan shape extruded upward. Length is extended in the vertex shader.
function pillGeometry(w, d, r, h, bevel) {
  const s = new THREE.Shape(); const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // extrusion now points up; the bottom bevel sits just below the road surface
  return g;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03020a);
    this.scene.fog = new THREE.Fog(0x12031f, 18, 70);
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 400);
    this.camBase = new THREE.Vector3(0, 3.3, 7.2); this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, 0.3, -14);
    this.energy = 0; this.energyShown = 0; this.time = 0; this.kick = 0; this.dip = 0; this.glitch = 0; this.pulse = 0; this.hitIdx = 0;
    this.lanePulse = [0, 0, 0, 0];
    this.hits = []; for (let i = 0; i < MAX_HITS; i++) this.hits.push(new THREE.Vector4(0, 0, -10, 0));
    this.white = new THREE.Color(1, 1, 1); this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpE = new THREE.Euler();
    this.tmpP = new THREE.Vector3(); this.tmpS = new THREE.Vector3(); this.tmpC = new THREE.Color();
    this._buildWorld(); this._buildPost(); this.resize();
  }
  _buildWorld() {
    const S = this.scene;
    // road
    const roadGeo = new THREE.PlaneGeometry(LANE_W * LANES, 140, 24, 120); roadGeo.rotateX(-Math.PI / 2); roadGeo.translate(0, 0, -55);
    this.roadMat = new THREE.ShaderMaterial({ vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uScroll: { value: 0 }, uEnergy: { value: 0 }, uLaneW: { value: LANE_W }, uWidth: { value: LANE_W * LANES }, uHue: { value: new THREE.Color(1, 0.5, 0.9) }, uHits: { value: this.hits }, uLane: { value: this.lanePulse } }]) });
    S.add(new THREE.Mesh(roadGeo, this.roadMat));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x05010c }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.position.z = -60; S.add(ground);
    // hit line + lane pads
    this.hitLine = new THREE.Mesh(new THREE.BoxGeometry(LANE_W * LANES + 0.4, 0.05, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.hitLine.position.set(0, 0.03, 0); S.add(this.hitLine);
    this.pads = [];
    for (let l = 0; l < LANES; l++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W * 0.86, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(laneX(l), 0.02, 0.2); S.add(m); this.pads.push(m);
    }
    // pills (3D rounded slabs)
    this.pillMat = new THREE.ShaderMaterial({ vertexShader: PILL_VERT, fragmentShader: PILL_FRAG, transparent: true, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uEnergy: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 0.35, -1).normalize() }, uR: { value: PILL_R } }]) });
    const pillGeo = pillGeometry(PILL_W, PILL_D, PILL_R, 0.09, 0.05);
    this.tileInst = new Float32Array(MAX_TILES * 4);
    pillGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(this.tileInst, 4).setUsage(THREE.DynamicDrawUsage));
    this.tiles = new THREE.InstancedMesh(pillGeo, this.pillMat, MAX_TILES);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.tiles.frustumCulled = false;
    for (let i = 0; i < MAX_TILES; i++) { this.tiles.setColorAt(i, this.tmpC.setRGB(1, 1, 1)); this._hideInstance(this.tiles, i); }
    S.add(this.tiles);
    // light pools cast by the pills onto the track (and the dark stain of a miss)
    this.decalMat = new THREE.ShaderMaterial({ vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false, uniforms: { uEnergy: { value: 0 } } });
    const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalInst = new Float32Array(MAX_TILES * 4);
    decalGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(this.decalInst, 4).setUsage(THREE.DynamicDrawUsage));
    this.decals = new THREE.InstancedMesh(decalGeo, this.decalMat, MAX_TILES);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.decals.frustumCulled = false;
    for (let i = 0; i < MAX_TILES; i++) { this.decals.setColorAt(i, this.tmpC.setRGB(1, 1, 1)); this._hideInstance(this.decals, i); }
    S.add(this.decals);
    // shards: chunky debris from hit pills, dark crumbs from missed ones
    this.shards = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_SHARDS);
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.shards.frustumCulled = false;
    this.shardData = []; for (let i = 0; i < MAX_SHARDS; i++) { this.shardData.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), rv: new THREE.Vector3(), c: new THREE.Color(), dark: false }); this.shards.setColorAt(i, this.tmpC.setRGB(1, 1, 1)); this._hideInstance(this.shards, i); }
    this.shardNext = 0; S.add(this.shards);
    // sun
    this.sunMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: SUN_FRAG });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), this.sunMat); sun.position.set(0, 16, -170); S.add(sun);
    // stars
    const starGeo = new THREE.BufferGeometry(); const sp = new Float32Array(900 * 3); const sc = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { const a = Math.random() * Math.PI * 2, el = Math.random() * 0.6 + 0.05, R = 230; sp[i*3] = Math.cos(a) * Math.cos(el) * R; sp[i*3+1] = Math.sin(el) * R * 0.6 + 5; sp[i*3+2] = Math.sin(a) * Math.cos(el) * R - 60; const b = 0.4 + Math.random() * 0.6; sc[i*3] = b; sc[i*3+1] = b * (0.8 + Math.random() * 0.2); sc[i*3+2] = 1; }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, fog: false })); S.add(this.stars);
    // spectrum towers
    this.towerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.towerMat, TOWERS_PER_SIDE * 2);
    this.towerInfo = [];
    for (let i = 0; i < TOWERS_PER_SIDE * 2; i++) {
      const side = i < TOWERS_PER_SIDE ? -1 : 1, k = i % TOWERS_PER_SIDE;
      const x = side * (LANE_W * LANES / 2 + 3.2 + (k % 3) * 1.6 + Math.random() * 1.2), z = -16 - k * 3.4 - Math.random() * 2;
      const w = 0.5 + Math.random() * 0.6; this.towerInfo.push({ x, z, w, bin: 2 + Math.floor(k * 1.7), h: 0.3, boost: 0, side });
      this.towers.setColorAt(i, this.tmpC.setRGB(0.2, 0.1, 0.4));
    }
    this.towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); S.add(this.towers);
    // distant ridges
    this.ridges = [];
    for (const side of [-1, 1]) for (let j = 0; j < 2; j++) {
      const pts = []; const n = 40;
      for (let i = 0; i <= n; i++) { const z = -20 - i * 4; const h = 2 + Math.abs(Math.sin(i * 1.7 + j * 3 + side)) * 7 + Math.sin(i * 0.4) * 3; pts.push(new THREE.Vector3(side * (12 + j * 9 + Math.sin(i * 0.9) * 3), h, z)); pts.push(new THREE.Vector3(side * (12 + j * 9 + Math.sin(i * 0.9 + 1) * 3), 0, z - 2)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: j ? 0x3a1060 : 0x6a1a90, transparent: true, opacity: 0.6 })); S.add(line); this.ridges.push(line);
    }
    // sparks
    this.pGeo = new THREE.BufferGeometry(); this.pPos = new Float32Array(MAX_PARTICLES * 3); this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3); this.pLife = new Float32Array(MAX_PARTICLES); this.pNext = 0;
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    S.add(this.particles);
  }
  _buildPost() {
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    const c = this.composer = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 0.8); c.addPass(this.bloom);
    this.fx = new ShaderPass(FX_SHADER); c.addPass(this.fx);
    c.addPass(new OutputPass());
  }
  _hideInstance(mesh, i) { this.tmpM.makeScale(0, 0, 0); mesh.setMatrixAt(i, this.tmpM); }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // portrait screens: widen the field of view and pull the camera back a little so all four lanes fit
    const a = this.camera.aspect; const k = a < 1 ? Math.sqrt(0.9 / a) : 1;
    this.camBase.set(0, 3.3 * k, 7.2 * k); this.camera.fov = a < 1 ? Math.min(100, 68 + (1 - a) * 40) : 68; this.camera.updateProjectionMatrix();
    this.hitLine.scale.set(1, k, k * 1.4); for (const p of this.pads) p.scale.set(1, k, 1);
  }
  setEnergy(e) { this.energy = Math.max(0, Math.min(1, e)); }
  tileColor(hue, out = this.tmpC) { return out.setHSL((0.97 - hue * 0.42 + 1) % 1, 0.95, 0.58); } // low pitch warm -> high pitch cool
  _spawnShard(x, y, z, col, dark, vx, vy, vz, life) {
    const k = this.shardNext; this.shardNext = (this.shardNext + 1) % MAX_SHARDS; const s = this.shardData[k];
    s.life = s.max = life; s.p.set(x, y, z); s.v.set(vx, vy, vz); s.r.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    s.rv.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14); s.c.copy(col); s.dark = dark;
  }
  _pushRipple(x, z, strength) { const h = this.hits[this.hitIdx]; this.hitIdx = (this.hitIdx + 1) % MAX_HITS; h.set(x, z, this.time, strength); }
  hit(lane, quality, hue, note) {
    const x = laneX(lane); const col = this.tileColor(hue, new THREE.Color());
    this._pushRipple(x, 0.3, quality === 2 ? 1.0 : 0.6);
    this.roadMat.uniforms.uHue.value.copy(col);
    this.lanePulse[lane] = quality === 2 ? 1.0 : 0.7;
    this.kick = Math.min(1, this.kick + (quality === 2 ? 0.9 : 0.5)); this.pulse = 1;
    // sparks
    const n = quality === 2 ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const k = this.pNext; this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      this.pPos[k*3] = x + (Math.random() - 0.5) * 0.6; this.pPos[k*3+1] = 0.2; this.pPos[k*3+2] = 0.3 + (Math.random() - 0.5) * 0.6;
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4;
      this.pVel[k*3] = Math.cos(a) * s * 0.6; this.pVel[k*3+1] = 2.5 + Math.random() * 5; this.pVel[k*3+2] = Math.sin(a) * s * 0.6 - 2;
      this.pLife[k] = 0.6 + Math.random() * 0.5;
      this.pCol[k*3] = col.r; this.pCol[k*3+1] = col.g; this.pCol[k*3+2] = col.b;
    }
    // shards burst out of the pill
    const m = quality === 2 ? 9 : 6;
    for (let i = 0; i < m; i++) { const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5; this._spawnShard(x + (Math.random() - 0.5) * 0.9, 0.18, 0.3 + (Math.random() - 0.5) * 0.5, col, false, Math.cos(a) * s, 3 + Math.random() * 5, Math.sin(a) * s * 0.5 + 0.4, 0.6 + Math.random() * 0.4); }
    // towers on that side of the road jump
    const side = lane < 2 ? -1 : 1; for (let i = 0; i < 3; i++) { const ti = this.towerInfo[Math.floor(Math.random() * TOWERS_PER_SIDE) + (side < 0 ? 0 : TOWERS_PER_SIDE)]; ti.boost = Math.max(ti.boost, 1.5 + Math.random() * 2 * (quality === 2 ? 1.2 : 0.7)); }
    this.pads[lane].material.opacity = 0.4; this.pads[lane].material.color.copy(col);
  }
  press(lane) { this.pads[lane].material.opacity = Math.max(this.pads[lane].material.opacity, 0.35); this.pads[lane].material.color.setRGB(0.6, 0.6, 1); }
  // called every frame while a hold is active in a lane: sparks stream up from the hit line, lane stays lit
  holdTick(lane, hue, dt) {
    const x = laneX(lane); const col = this.tileColor(hue, this.tmpC);
    this.lanePulse[lane] = Math.max(this.lanePulse[lane], 0.45);
    this.pads[lane].material.opacity = Math.max(this.pads[lane].material.opacity, 0.3); this.pads[lane].material.color.copy(col);
    this.holdAcc = (this.holdAcc || 0) + dt * 90;
    while (this.holdAcc >= 1) {
      this.holdAcc -= 1; const k = this.pNext; this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      this.pPos[k*3] = x + (Math.random() - 0.5) * 0.9; this.pPos[k*3+1] = 0.2; this.pPos[k*3+2] = 0.3 + (Math.random() - 0.5) * 0.4;
      this.pVel[k*3] = (Math.random() - 0.5) * 1.2; this.pVel[k*3+1] = 2.5 + Math.random() * 3; this.pVel[k*3+2] = -0.5 + Math.random();
      this.pLife[k] = 0.5 + Math.random() * 0.4;
      this.pCol[k*3] = col.r; this.pCol[k*3+1] = col.g; this.pCol[k*3+2] = col.b;
    }
    this.pulse = Math.max(this.pulse, 0.25);
  }
  // a hold completed: a second, bigger burst
  holdDone(lane, hue) {
    const x = laneX(lane); const col = this.tileColor(hue, new THREE.Color());
    this._pushRipple(x, 0.3, 1.0); this.lanePulse[lane] = 1.0; this.kick = Math.min(1, this.kick + 0.7); this.pulse = 1;
    for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4; this._spawnShard(x + (Math.random() - 0.5) * 0.9, 0.2, 0.3 + (Math.random() - 0.5) * 0.5, col, false, Math.cos(a) * s, 4 + Math.random() * 5, Math.sin(a) * s * 0.5 + 0.4, 0.6 + Math.random() * 0.4); }
  }
  // tile: true when a note was missed (the pill sinks and the road is scarred); false for a tap on an empty lane
  miss(lane, tile = false, hue = 0) {
    this.glitch = Math.min(1, this.glitch + (tile ? 0.8 : 0.4));
    if (lane == null) return;
    this.pads[lane].material.opacity = 0.6; this.pads[lane].material.color.setRGB(1, 0.15, 0.2);
    this.lanePulse[lane] = Math.min(this.lanePulse[lane], tile ? -1.0 : -0.5);
    if (!tile) return;
    const x = laneX(lane); this.dip = Math.min(1, this.dip + 0.8);
    this._pushRipple(x, 1.2, -1.0);
    const dark = new THREE.Color(0.7, 0.08, 0.12);
    for (let i = 0; i < 7; i++) { const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 1.2; this._spawnShard(x + (Math.random() - 0.5) * 1.0, 0.12, 1.2 + (Math.random() - 0.5) * 0.6, dark, true, Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s + 1.0, 0.9 + Math.random() * 0.6); }
  }
  setSpectrum(data) { this.spectrum = data; }
  // tiles: chart tiles array; songTime: seconds; speed: units per second
  update(dt, songTime, speed, tiles, tileStart = 0) {
    this.time += dt;
    const e = this.energyShown += (this.energy - this.energyShown) * Math.min(1, dt * 3);
    this.kick *= Math.exp(-dt * 9); this.dip *= Math.exp(-dt * 6); this.glitch *= Math.exp(-dt * 6); this.pulse *= Math.exp(-dt * 7);
    for (let l = 0; l < LANES; l++) this.lanePulse[l] *= Math.exp(-dt * (this.lanePulse[l] > 0 ? 7 : 3.5));
    // camera
    const sway = Math.sin(this.time * 0.7) * 0.12 * e;
    this.camera.position.set(this.camBase.x + sway, this.camBase.y - this.kick * 0.18 - this.dip * 0.3 + Math.sin(this.time * 1.3) * 0.05 * e, this.camBase.z - this.kick * 0.5);
    this.camera.lookAt(sway * 0.4, 0.3 + this.kick * 0.2 - this.dip * 0.15, -14);
    // uniforms
    const ru = this.roadMat.uniforms; ru.uTime.value = this.time; ru.uScroll.value = songTime * speed; ru.uEnergy.value = e;
    this.pillMat.uniforms.uTime.value = this.time; this.pillMat.uniforms.uEnergy.value = e; this.decalMat.uniforms.uEnergy.value = e;
    this.sunMat.uniforms.uTime.value = this.time; this.sunMat.uniforms.uEnergy.value = e; this.sunMat.uniforms.uPulse.value = this.pulse;
    this.scene.fog.near = 14 + 16 * e; this.scene.fog.far = 40 + 70 * e; this.scene.fog.color.setHSL(0.78 - 0.08 * e, 0.6, 0.03 + 0.05 * e);
    this.scene.background.setHSL(0.75, 0.5, 0.012 + 0.03 * e);
    this.bloom.strength = 0.3 + 0.5 * e + this.pulse * 0.15; this.bloom.threshold = 0.82 - 0.12 * e;
    this.fx.uniforms.uGlitch.value = this.glitch; this.fx.uniforms.uSat.value = 0.6 + 0.4 * e - this.glitch * 0.15; this.fx.uniforms.uTime.value = this.time;
    this.stars.material.opacity = 0.2 + 0.35 * e; this.hitLine.material.color.setHSL(0.85, 0.3, 0.5 + 0.25 * e);
    for (const r of this.ridges) r.material.opacity = 0.25 + 0.6 * e;
    for (const p of this.pads) p.material.opacity *= Math.exp(-dt * 8);
    // pills + light pools
    let n = 0; const zFar = -24 - 60 * speed / 9; const ti = this.tileInst, di = this.decalInst;
    if (tiles) {
      for (let i = tileStart; i < tiles.length && n < MAX_TILES; i++) {
        const t = tiles[i]; const rel = t.t - songTime;
        if (rel * speed < zFar) break; // too far ahead (tiles sorted by time)
        if (t.state === 1 && (this.time - t.hitAt) > 0.32) continue; // hit & faded
        const endRel = rel + (t.hold || 0);                       // when the tail (or the tap) passes the hit line
        if (-endRel * speed > 3.4) continue;                      // whole pill is well past the line: dropped before it can reach the camera
        if (t.state === 2 && (this.time - (t.missAt || 0)) > 0.7) continue; // miss animation finished
        // taps are short fixed pills; holds stretch to their duration (head at the note start, tail toward the horizon)
        const len = t.hold ? Math.max(PILL_D + 0.3, t.hold * speed) : 0.75; const z = -rel * speed - len / 2 + 0.3;
        const col = this.tileColor(t.hue, this.tmpC);
        let state = 0, param = 0, sx = 1, sy = 1, y = 0, dGrow = 1, hitLocal = 0;
        if (t.state === 1) { const a = Math.min(1, (this.time - t.hitAt) / 0.32); state = 1; param = a; sx = 1 + a * 0.35; sy = Math.max(0.15, 1 - a * 1.2); dGrow = 1 + a * 0.4; }
        else if (t.state === 2) { const a = Math.min(1, (this.time - (t.missAt || this.time)) / 0.6); state = 2; param = a; y = -a * 0.2; sy = 1 - a * 0.6; dGrow = 1 + a * 0.3; }
        else if (t.state === 3) { state = 3; param = Math.max(0, Math.min(1, (songTime - t.t) / Math.max(0.01, t.hold))); hitLocal = 0.3 - z; sy = 1.15; }
        else { param = Math.max(0, 1 - Math.abs(rel) / 0.3); sy = 1 + param * 0.25; }
        this.tmpQ.identity(); this.tmpP.set(laneX(t.lane), y, z); this.tmpS.set(sx, sy, 1);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS); this.tiles.setMatrixAt(n, this.tmpM); this.tiles.setColorAt(n, col);
        ti[n * 4] = state; ti[n * 4 + 1] = param; ti[n * 4 + 2] = len - PILL_D; ti[n * 4 + 3] = hitLocal;
        // light pool on the road beneath it
        this.tmpQ.identity(); this.tmpP.set(laneX(t.lane), 0.012, z); this.tmpS.set((PILL_W + DECAL_PAD) * dGrow, 1, (len + DECAL_PAD) * dGrow);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS); this.decals.setMatrixAt(n, this.tmpM); this.decals.setColorAt(n, col);
        di[n * 4] = state; di[n * 4 + 1] = param; di[n * 4 + 2] = 0; di[n * 4 + 3] = 0;
        n++;
      }
    }
    for (let i = n; i < MAX_TILES; i++) { this._hideInstance(this.tiles, i); this._hideInstance(this.decals, i); }
    this.tiles.instanceMatrix.needsUpdate = true; this.tiles.instanceColor.needsUpdate = true; this.tiles.geometry.attributes.aInst.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true; this.decals.instanceColor.needsUpdate = true; this.decals.geometry.attributes.aInst.needsUpdate = true;
    // shards
    for (let k = 0; k < MAX_SHARDS; k++) {
      const s = this.shardData[k];
      if (s.life <= 0) { this._hideInstance(this.shards, k); continue; }
      s.life -= dt; s.v.y -= 16 * dt; s.p.addScaledVector(s.v, dt); s.r.addScaledVector(s.rv, dt);
      if (s.p.y < 0.04) { s.p.y = 0.04; s.v.y *= -0.35; s.v.x *= 0.7; s.v.z *= 0.7; s.rv.multiplyScalar(0.5); }
      const f = Math.max(0, s.life / s.max); const sc = s.dark ? 0.9 * f : (0.6 + 0.6 * f);
      this.tmpE.set(s.r.x, s.r.y, s.r.z); this.tmpQ.setFromEuler(this.tmpE); this.tmpS.set(sc, sc, sc);
      this.tmpM.compose(s.p, this.tmpQ, this.tmpS); this.shards.setMatrixAt(k, this.tmpM);
      this.shards.setColorAt(k, s.dark ? this.tmpC.copy(s.c).multiplyScalar(0.5 + 0.5 * f) : this.tmpC.copy(s.c).multiplyScalar(0.8 + 1.4 * f));
    }
    this.shards.instanceMatrix.needsUpdate = true; this.shards.instanceColor.needsUpdate = true;
    // towers from spectrum (+ hit boosts)
    const sp = this.spectrum;
    for (let i = 0; i < this.towerInfo.length; i++) {
      const tw = this.towerInfo[i]; let target = 0.3;
      if (sp) { const v = sp[Math.min(sp.length - 1, tw.bin)] / 255; target = 0.3 + Math.pow(v, 1.8) * (2.5 + 5 * e); }
      tw.boost *= Math.exp(-dt * 4); target += tw.boost;
      tw.h += (target - tw.h) * Math.min(1, dt * (target > tw.h ? 18 : 5));
      this.tmpQ.identity(); this.tmpP.set(tw.x, tw.h / 2, tw.z); this.tmpS.set(tw.w, tw.h, tw.w); this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS); this.towers.setMatrixAt(i, this.tmpM);
      this.towers.setColorAt(i, this.tmpC.setHSL(0.78 - 0.3 * e + tw.h * 0.02, 0.9, 0.05 + 0.25 * e * Math.min(1, tw.h / 4) + tw.boost * 0.05));
    }
    this.towers.instanceMatrix.needsUpdate = true; this.towers.instanceColor.needsUpdate = true;
    // sparks
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.pLife[k] <= 0) { this.pPos[k*3+1] = -5; continue; }
      this.pLife[k] -= dt; this.pVel[k*3+1] -= 9 * dt;
      this.pPos[k*3] += this.pVel[k*3] * dt; this.pPos[k*3+1] += this.pVel[k*3+1] * dt; this.pPos[k*3+2] += this.pVel[k*3+2] * dt;
      if (this.pPos[k*3+1] < 0.02) { this.pPos[k*3+1] = 0.02; this.pVel[k*3+1] *= -0.4; }
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true;
  }
  render() { this.composer.render(); }
}
