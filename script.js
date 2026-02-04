// =============================
// 2D Minecraft (no multiplayer)
// =============================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Prevent right-click menu (we use RMB for placing blocks)
canvas.addEventListener("contextmenu", e => e.preventDefault());

// ---------- Tuning ----------
const TILE = 32;
const CHUNK_W = 32;          // tiles per chunk horizontally
const WORLD_H = 80;          // vertical tiles in a chunk (fixed height)
const LOAD_RADIUS = 3;       // chunks to load left/right of player
const REACH = 5 * TILE;      // block reach distance in pixels

// Physics
const GRAVITY = 0.55;
const FRICTION = 0.80;
const MOVE_ACCEL = 0.8;
const MAX_RUN = 6.2;
const JUMP_V = 11.5;

// Day/night not included yet — easy add later.

// ---------- Block IDs ----------
const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  LOG: 4,
  LEAVES: 5,
  COAL: 6,
  IRON: 7
};

const BLOCK_INFO = {
  [BLOCK.AIR]:    { name: "Air",    solid: false, color: "rgba(0,0,0,0)" },
  [BLOCK.GRASS]:  { name: "Grass",  solid: true,  color: "#2ecc71" },
  [BLOCK.DIRT]:   { name: "Dirt",   solid: true,  color: "#8b5a2b" },
  [BLOCK.STONE]:  { name: "Stone",  solid: true,  color: "#808080" },
  [BLOCK.LOG]:    { name: "Log",    solid: true,  color: "#a06a3b" },
  [BLOCK.LEAVES]: { name: "Leaves", solid: true,  color: "#2e8b57" },
  [BLOCK.COAL]:   { name: "Coal",   solid: true,  color: "#444" },
  [BLOCK.IRON]:   { name: "Iron",   solid: true,  color: "#c9b07e" }
};

// ---------- Input ----------
const keys = {};
document.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
document.addEventListener("keyup",   e => keys[e.key.toLowerCase()] = false);

// Hotbar selection (1..6)
let selectedSlot = 0;
document.addEventListener("keydown", e => {
  const k = e.key;
  if (k >= "1" && k <= "6") selectedSlot = parseInt(k, 10) - 1;
});

// ---------- Camera ----------
const camera = { x: 0, y: 0 };

// ---------- Player ----------
const player = {
  x: 0,
  y: 0,
  w: 26,
  h: 30,
  vx: 0,
  vy: 0,
  onGround: false,

  // Survival stats
  maxHealth: 20,
  health: 20,
  maxHunger: 20,
  hunger: 20
};

// Spawn near chunk 0
player.x = 2 * TILE;
player.y = 10 * TILE;

// ---------- Inventory / Hotbar ----------
const hotbar = [
  { block: BLOCK.DIRT,  count: 20 },
  { block: BLOCK.STONE, count: 0  },
  { block: BLOCK.LOG,   count: 0  },
  { block: BLOCK.LEAVES,count: 0  },
  { block: BLOCK.GRASS, count: 0  },
  { block: BLOCK.IRON,  count: 0  }
];

// ---------- World Storage (chunks) ----------
/**
 * Each chunk is stored in a Map with key = chunkX (integer).
 * chunk data: 2D array [WORLD_H][CHUNK_W]
 */
const chunks = new Map();

// ---------- Seeded noise helpers ----------
const SEED = 1337; // change to get different worlds

function hash2D(x, y) {
  // Deterministic pseudo-random from integer coordinates
  let n = x * 374761393 + y * 668265263 + SEED * 1442695040888963407n; // mix
  // Use BigInt for stable mixing, then reduce:
  n = BigInt.asUintN(64, BigInt(n));
  // Xorshift-ish
  n ^= (n >> 12n);
  n ^= (n << 25n);
  n ^= (n >> 27n);
  // Convert to [0,1)
  const out = Number(n & 0xFFFFFFFFn) / 0x100000000;
  return out;
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

function lerp(a, b, t) { return a + (b - a) * t; }

// 1D value noise for terrain height
function noise1D(x) {
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const t = smoothstep(x - x0);
  const v0 = hash2D(x0, 0);
  const v1 = hash2D(x1, 0);
  return lerp(v0, v1, t);
}

// 2D value noise for caves/ore
function noise2D(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1,     y1 = y0 + 1;
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const v00 = hash2D(x0, y0);
  const v10 = hash2D(x1, y0);
  const v01 = hash2D(x0, y1);
  const v11 = hash2D(x1, y1);

  const a = lerp(v00, v10, tx);
  const b = lerp(v01, v11, tx);
  return lerp(a, b, ty);
}

// ---------- Chunk generation ----------
function generateChunk(chunkX) {
  // Create empty chunk (air)
  const data = Array.from({ length: WORLD_H }, () => Array(CHUNK_W).fill(BLOCK.AIR));

  // Base height variations
  // World Y increases downward (0 top)
  for (let localX = 0; localX < CHUNK_W; localX++) {
    const worldX = chunkX * CHUNK_W + localX;

    // Terrain height using layered noise
    const h1 = noise1D(worldX * 0.06) * 8;
    const h2 = noise1D(worldX * 0.012) * 18;
    const groundY = Math.floor(35 + h1 + h2); // around mid-lower

    for (let y = 0; y < WORLD_H; y++) {
      if (y < groundY) continue; // air above ground

      // top block
      if (y === groundY) data[y][localX] = BLOCK.GRASS;
      else if (y < groundY + 4) data[y][localX] = BLOCK.DIRT;
      else data[y][localX] = BLOCK.STONE;
    }

    // Caves: carve out some stone/dirt below surface
    for (let y = groundY + 3; y < WORLD_H; y++) {
      const n = noise2D(worldX * 0.12, y * 0.12);
      if (n > 0.70) data[y][localX] = BLOCK.AIR;
    }

    // Ores: replace some stone with coal/iron (only if stone)
    for (let y = groundY + 6; y < WORLD_H; y++) {
      if (data[y][localX] !== BLOCK.STONE) continue;
      const n = noise2D(worldX * 0.18, y * 0.18);

      // Coal more common
      if (n > 0.82) data[y][localX] = BLOCK.COAL;

      // Iron deeper, less common
      if (y > 50 && n > 0.88) data[y][localX] = BLOCK.IRON;
    }

    // Trees: occasionally on grass with enough space
    const treeChance = noise1D(worldX * 0.2);
    if (treeChance > 0.86) {
      const y = groundY;
      if (y >= 0 && y < WORLD_H && data[y][localX] === BLOCK.GRASS) {
        placeTree(data, localX, y - 1, worldX);
      }
    }
  }

  return data;
}

function placeTree(chunkData, x, baseY, worldX) {
  // baseY is block above grass
  const height = 4 + Math.floor(noise1D(worldX * 0.9) * 3); // 4..6
  // trunk
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    if (y < 0) break;
    if (chunkData[y] && chunkData[y][x] === BLOCK.AIR) chunkData[y][x] = BLOCK.LOG;
  }

  // leaves blob near top
  const topY = baseY - (height - 1);
  for (let ly = -2; ly <= 2; ly++) {
    for (let lx = -2; lx <= 2; lx++) {
      const y = topY + ly;
      const xx = x + lx;
      if (y < 0 || y >= WORLD_H) continue;
      if (xx < 0 || xx >= CHUNK_W) continue;

      const dist = Math.abs(lx) + Math.abs(ly);
      if (dist <= 3 && chunkData[y][xx] === BLOCK.AIR) {
        chunkData[y][xx] = BLOCK.LEAVES;
      }
    }
  }
}

function getChunk(chunkX) {
  if (!chunks.has(chunkX)) {
    chunks.set(chunkX, generateChunk(chunkX));
  }
  return chunks.get(chunkX);
}

// ---------- Tile access ----------
function worldToTile(px, py) {
  return {
    tx: Math.floor(px / TILE),
    ty: Math.floor(py / TILE)
  };
}

function getBlock(tx, ty) {
  if (ty < 0 || ty >= WORLD_H) return BLOCK.AIR;
  const cx = Math.floor(tx / CHUNK_W);
  const lx = ((tx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  const chunk = getChunk(cx);
  return chunk[ty][lx];
}

function setBlock(tx, ty, id) {
  if (ty < 0 || ty >= WORLD_H) return;
  const cx = Math.floor(tx / CHUNK_W);
  const lx = ((tx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  const chunk = getChunk(cx);
  chunk[ty][lx] = id;
}

function isSolid(id) {
  return BLOCK_INFO[id]?.solid ?? false;
}

// ---------- Collision ----------
function rectVsWorld(px, py, pw, ph) {
  // checks if any solid tile overlaps with rect
  const left = Math.floor(px / TILE);
  const right = Math.floor((px + pw - 1) / TILE);
  const top = Math.floor(py / TILE);
  const bottom = Math.floor((py + ph - 1) / TILE);

  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      const b = getBlock(tx, ty);
      if (isSolid(b)) return true;
    }
  }
  return false;
}

function moveAndCollide() {
  // Horizontal
  player.x += player.vx;
  if (rectVsWorld(player.x, player.y, player.w, player.h)) {
    // push out
    const step = Math.sign(player.vx);
    while (rectVsWorld(player.x, player.y, player.w, player.h)) {
      player.x -= step;
    }
    player.vx = 0;
  }

  // Vertical
  player.y += player.vy;
  player.onGround = false;

  if (rectVsWorld(player.x, player.y, player.w, player.h)) {
    const step = Math.sign(player.vy);
    while (rectVsWorld(player.x, player.y, player.w, player.h)) {
      player.y -= step;
    }
    if (step > 0) player.onGround = true; // fell onto ground
    player.vy = 0;
  }
}

// ---------- Survival (health/hunger) ----------
let hungerTimer = 0;

function updateSurvival(dt) {
  // Hunger drains slowly; faster if moving
  const moving = Math.abs(player.vx) > 0.2;
  hungerTimer += dt * (moving ? 1.4 : 1.0);

  // drain every ~4 seconds
  if (hungerTimer > 4.0) {
    hungerTimer = 0;
    player.hunger = Math.max(0, player.hunger - 1);
  }

  // Regen if hunger high
  if (player.hunger >= 16 && player.health < player.maxHealth) {
    if (Math.random() < 0.02) player.health += 1;
  }

  // Starve damage if hunger empty
  if (player.hunger === 0) {
    if (Math.random() < 0.03) player.health = Math.max(0, player.health - 1);
  }

  // If dead, respawn
  if (player.health <= 0) {
    player.health = player.maxHealth;
    player.hunger = player.maxHunger;
    player.x = 2 * TILE;
    player.y = 10 * TILE;
    player.vx = 0; player.vy = 0;
  }
}

// ---------- Chunk loading around player ----------
function ensureChunksLoaded() {
  const playerTileX = Math.floor(player.x / TILE);
  const playerChunkX = Math.floor(playerTileX / CHUNK_W);

  for (let cx = playerChunkX - LOAD_RADIUS; cx <= playerChunkX + LOAD_RADIUS; cx++) {
    getChunk(cx);
  }

  // Optional: unload far chunks to save memory
  // Keep a limited window
  for (const key of chunks.keys()) {
    if (Math.abs(key - playerChunkX) > LOAD_RADIUS + 2) {
      chunks.delete(key);
    }
  }
}

// ---------- Mouse interaction: break/place ----------
function screenToWorld(mx, my) {
  return { wx: mx + camera.x, wy: my + camera.y };
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function canReachTile(tx, ty) {
  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  return distance(px, py, cx, cy) <= REACH;
}

function addToInventory(blockId, amount = 1) {
  // try to add to hotbar slot with same block, else ignore if none
  for (const slot of hotbar) {
    if (slot.block === blockId) {
      slot.count += amount;
      return true;
    }
  }
  return false;
}

function removeFromSelected(amount = 1) {
  const slot = hotbar[selectedSlot];
  if (!slot) return false;
  if (slot.count < amount) return false;
  slot.count -= amount;
  return true;
}

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { wx, wy } = screenToWorld(mx, my);
  const { tx, ty } = worldToTile(wx, wy);

  if (!canReachTile(tx, ty)) return;

  // 0 = left button (break), 2 = right button (place)
  if (e.button === 0) {
    // BREAK
    const b = getBlock(tx, ty);
    if (b !== BLOCK.AIR) {
      setBlock(tx, ty, BLOCK.AIR);
      // collect block (simple rule: you get what you break)
      addToInventory(b, 1);
    }
  } else if (e.button === 2) {
    // PLACE
    const slot = hotbar[selectedSlot];
    if (!slot) return;

    // can only place if air
    if (getBlock(tx, ty) !== BLOCK.AIR) return;

    // must have blocks
    if (slot.count <= 0) return;

    // prevent placing inside player
    const placeRect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    const overlapsPlayer =
      !(placeRect.x + placeRect.w <= player.x ||
        placeRect.x >= player.x + player.w ||
        placeRect.y + placeRect.h <= player.y ||
        placeRect.y >= player.y + player.h);

    if (overlapsPlayer) return;

    // place it
    setBlock(tx, ty, slot.block);
    removeFromSelected(1);
  }
});

// ---------- Rendering ----------
function drawTile(tx, ty, id) {
  if (id === BLOCK.AIR) return;

  const x = tx * TILE - camera.x;
  const y = ty * TILE - camera.y;

  // cull offscreen quickly
  if (x + TILE < 0 || y + TILE < 0 || x > canvas.width || y > canvas.height) return;

  ctx.fillStyle = BLOCK_INFO[id].color;
  ctx.fillRect(x, y, TILE, TILE);

  // simple shading
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(x, y, TILE, 4);
  ctx.fillRect(x, y, 4, TILE);

  // ore speckles
  if (id === BLOCK.COAL || id === BLOCK.IRON) {
    ctx.fillStyle = id === BLOCK.COAL ? "#222" : "#b08d57";
    for (let i = 0; i < 5; i++) {
      const sx = x + 6 + Math.random() * (TILE - 12);
      const sy = y + 6 + Math.random() * (TILE - 12);
      ctx.fillRect(sx, sy, 3, 3);
    }
  }
}

function drawWorld() {
  // Determine visible tile bounds
  const left = Math.floor(camera.x / TILE) - 1;
  const right = Math.floor((camera.x + canvas.width) / TILE) + 1;
  const top = Math.floor(camera.y / TILE) - 1;
  const bottom = Math.floor((camera.y + canvas.height) / TILE) + 1;

  for (let ty = Math.max(0, top); ty <= Math.min(WORLD_H - 1, bottom); ty++) {
    for (let tx = left; tx <= right; tx++) {
      drawTile(tx, ty, getBlock(tx, ty));
    }
  }
}

function drawPlayer() {
  const x = player.x - camera.x;
  const y = player.y - camera.y;

  // body
  ctx.fillStyle = "#ff3b30";
  ctx.fillRect(x, y, player.w, player.h);

  // face highlight
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(x + 4, y + 5, player.w - 8, 8);
}

function drawUI() {
  // Hearts (health)
  const hearts = player.maxHealth / 2;
  const fullHearts = Math.floor(player.health / 2);
  const half = player.health % 2;

  for (let i = 0; i < hearts; i++) {
    const x = 12 + i * 18;
    const y = 12;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(x, y, 14, 14);

    if (i < fullHearts) {
      ctx.fillStyle = "#ff2d55";
      ctx.fillRect(x, y, 14, 14);
    } else if (i === fullHearts && half) {
      ctx.fillStyle = "#ff2d55";
      ctx.fillRect(x, y, 7, 14);
    }
  }

  // Hunger
  const food = player.maxHunger / 2;
  const fullFood = Math.floor(player.hunger / 2);
  const halfFood = player.hunger % 2;

  for (let i = 0; i < food; i++) {
    const x = 12 + i * 18;
    const y = 32;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(x, y, 14, 14);

    if (i < fullFood) {
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(x, y, 14, 14);
    } else if (i === fullFood && halfFood) {
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(x, y, 7, 14);
    }
  }

  // Hotbar
  const barW = 6 * 64;
  const startX = canvas.width / 2 - barW / 2;
  const y = canvas.height - 74;

  for (let i = 0; i < 6; i++) {
    const slotX = startX + i * 64;

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(slotX, y, 58, 58);

    ctx.strokeStyle = (i === selectedSlot) ? "white" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = (i === selectedSlot) ? 3 : 1;
    ctx.strokeRect(slotX, y, 58, 58);

    const item = hotbar[i];
    if (!item) continue;

    // draw item as colored square
    ctx.fillStyle = BLOCK_INFO[item.block].color;
    ctx.fillRect(slotX + 16, y + 14, 26, 26);

    // count
    ctx.fillStyle = "white";
    ctx.font = "14px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(String(item.count), slotX + 54, y + 52);
  }

  // Selected block name
  const sel = hotbar[selectedSlot];
  if (sel) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(canvas.width/2 - 90, canvas.height - 104, 180, 24);
    ctx.fillStyle = "white";
    ctx.font = "13px system-ui";
    ctx.fillText(BLOCK_INFO[sel.block].name, canvas.width/2, canvas.height - 86);
  }
}

// ---------- Update ----------
let lastTime = performance.now();

function update(dt) {
  // Load nearby chunks
  ensureChunksLoaded();

  // Input movement
  const left = keys["a"] || keys["arrowleft"];
  const right = keys["d"] || keys["arrowright"];
  const jump = keys["w"] || keys["arrowup"] || keys[" "];

  if (left) player.vx -= MOVE_ACCEL;
  if (right) player.vx += MOVE_ACCEL;

  // Clamp run speed
  player.vx = Math.max(-MAX_RUN, Math.min(MAX_RUN, player.vx));

  // friction when no input
  if (!left && !right) player.vx *= FRICTION;

  // Jumping
  if (jump && player.onGround) {
    player.vy = -JUMP_V;
    player.onGround = false;
  }

  // Gravity
  player.vy += GRAVITY;
  player.vy = Math.min(player.vy, 18);

  // Apply movement + collisions
  moveAndCollide();

  // Camera follows player
  camera.x = player.x + player.w / 2 - canvas.width / 2;
  camera.y = player.y + player.h / 2 - canvas.height / 2;

  // clamp camera Y (world has fixed height)
  camera.y = Math.max(0, Math.min(camera.y, WORLD_H * TILE - canvas.height));

  // Survival systems
  updateSurvival(dt);
}

// ---------- Main loop ----------
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw
  drawWorld();
  drawPlayer();
  drawUI();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
