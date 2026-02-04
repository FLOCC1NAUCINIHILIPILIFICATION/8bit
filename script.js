/* 2D Minecraft-like Sandbox (Stable Copy/Paste)
   - No external assets
   - Chunked procedural world
   - Caves, trees, ores
   - Solid collision + gravity + jump
   - Break/place blocks with mouse
   - Hotbar 1–6 + inventory counts
   - Save/Load to localStorage (K/L)
   - Error overlay to prevent "blank screen mystery"
*/

(() => {
  "use strict";

  // ---------- Error Overlay ----------
  const errorBox = document.getElementById("errorBox");
  const errorText = document.getElementById("errorText");
  function showError(msg) {
    if (!errorBox || !errorText) return;
    errorText.textContent = String(msg || "Unknown error");
    errorBox.hidden = false;
  }
  window.addEventListener("error", (e) => {
    showError(`${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    showError(`Unhandled Promise Rejection:\n${e.reason}`);
  });

  // ---------- Canvas ----------
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) throw new Error("Canvas #gameCanvas not found. Check index.html.");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D context not available.");

  // Prevent right-click menu (we use RMB)
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- Constants ----------
  const TILE = 32;
  const CHUNK_W = 32;
  const WORLD_H = 80;         // fixed world height in tiles
  const LOAD_RADIUS = 4;      // chunks to keep loaded
  const REACH = 5 * TILE;

  // Physics
  const GRAVITY = 0.55;
  const MAX_FALL = 18;
  const MOVE_ACCEL = 0.85;
  const MAX_RUN = 6.4;
  const FRICTION = 0.82;
  const JUMP_V = 11.5;

  // ---------- Blocks ----------
  const BLOCK = Object.freeze({
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    LOG: 4,
    LEAVES: 5,
    COAL: 6,
    IRON: 7
  });

  const BLOCK_INFO = Object.freeze({
    [BLOCK.AIR]:    { name: "Air",    solid: false, color: "rgba(0,0,0,0)" },
    [BLOCK.GRASS]:  { name: "Grass",  solid: true,  color: "#2ecc71" },
    [BLOCK.DIRT]:   { name: "Dirt",   solid: true,  color: "#8b5a2b" },
    [BLOCK.STONE]:  { name: "Stone",  solid: true,  color: "#808080" },
    [BLOCK.LOG]:    { name: "Log",    solid: true,  color: "#a06a3b" },
    [BLOCK.LEAVES]: { name: "Leaves", solid: true,  color: "#2e8b57" },
    [BLOCK.COAL]:   { name: "Coal",   solid: true,  color: "#444444" },
    [BLOCK.IRON]:   { name: "Iron",   solid: true,  color: "#c9b07e" }
  });

  function isSolid(id) {
    const info = BLOCK_INFO[id];
    return info ? info.solid : false;
  }

  // ---------- Input ----------
  const keys = Object.create(null);
  document.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    // hotbar 1-6
    if (e.key >= "1" && e.key <= "6") selectedSlot = (e.key.charCodeAt(0) - 49);
    // save/load
    if (e.key.toLowerCase() === "k") saveGame();
    if (e.key.toLowerCase() === "l") loadGame();
  });
  document.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // ---------- Player ----------
  const player = {
    x: 2 * TILE,
    y: 10 * TILE,
    w: 26,
    h: 30,
    vx: 0,
    vy: 0,
    onGround: false,
    maxHealth: 20,
    health: 20,
    maxHunger: 20,
    hunger: 20
  };

  // ---------- Hotbar ----------
  let selectedSlot = 0;
  const hotbar = [
    { block: BLOCK.DIRT,  count: 40 },
    { block: BLOCK.STONE, count: 0  },
    { block: BLOCK.LOG,   count: 0  },
    { block: BLOCK.LEAVES,count: 0  },
    { block: BLOCK.GRASS, count: 0  },
    { block: BLOCK.IRON,  count: 0  }
  ];

  // ---------- Camera ----------
  const camera = { x: 0, y: 0 };

  // ---------- Stable Seeded Noise (NO BigInt) ----------
  const SEED = 1337;

  function hash2D(x, y) {
    // 32-bit integer hash (fast + deterministic + safe)
    let n = (x * 374761393 + y * 668265263 + SEED * 1442695041) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = (n * 1274126177) | 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296; // [0,1)
  }

  const smoothstep = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;

  function noise1D(x) {
    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const t = smoothstep(x - x0);
    const v0 = hash2D(x0, 0);
    const v1 = hash2D(x1, 0);
    return lerp(v0, v1, t);
  }

  function noise2D(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1,     y1 = y0 + 1;
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);

    const v00 = hash2D(x0, y0);
    const v10 = hash2D(x1, y0);
    const v01 = hash2D(x0, y1);
    const v11 = hash2D(x1, y1);

    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
  }

  // ---------- Chunks ----------
  // Map<chunkX, data[WORLD_H][CHUNK_W]>
  const chunks = new Map();

  function getChunk(cx) {
    if (!chunks.has(cx)) chunks.set(cx, generateChunk(cx));
    return chunks.get(cx);
  }

  function generateChunk(cx) {
    const data = Array.from({ length: WORLD_H }, () => Array(CHUNK_W).fill(BLOCK.AIR));

    for (let lx = 0; lx < CHUNK_W; lx++) {
      const wx = cx * CHUNK_W + lx;

      // terrain: layered noise
      const h1 = noise1D(wx * 0.06) * 8;
      const h2 = noise1D(wx * 0.012) * 18;
      const groundY = clampInt(Math.floor(35 + h1 + h2), 10, WORLD_H - 2);

      // fill ground
      for (let y = groundY; y < WORLD_H; y++) {
        if (y === groundY) data[y][lx] = BLOCK.GRASS;
        else if (y < groundY + 4) data[y][lx] = BLOCK.DIRT;
        else data[y][lx] = BLOCK.STONE;
      }

      // caves
      for (let y = groundY + 4; y < WORLD_H; y++) {
        const n = noise2D(wx * 0.12, y * 0.12);
        if (n > 0.70) data[y][lx] = BLOCK.AIR;
      }

      // ores (only in stone)
      for (let y = groundY + 6; y < WORLD_H; y++) {
        if (data[y][lx] !== BLOCK.STONE) continue;
        const n = noise2D(wx * 0.18, y * 0.18);
        if (n > 0.82) data[y][lx] = BLOCK.COAL;
        if (y > 50 && n > 0.88) data[y][lx] = BLOCK.IRON;
      }

      // trees on grass (random-ish)
      const treeChance = noise1D(wx * 0.2);
      if (treeChance > 0.86) {
        if (data[groundY][lx] === BLOCK.GRASS) {
          placeTree(data, lx, groundY - 1, wx);
        }
      }
    }
    return data;
  }

  function placeTree(chunkData, lx, baseY, wx) {
    const height = 4 + Math.floor(noise1D(wx * 0.9) * 3); // 4..6
    // trunk
    for (let i = 0; i < height; i++) {
      const y = baseY - i;
      if (y < 0) break;
      if (chunkData[y][lx] === BLOCK.AIR) chunkData[y][lx] = BLOCK.LOG;
    }
    // leaves blob
    const topY = baseY - (height - 1);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const y = topY + dy;
        const x = lx + dx;
        if (y < 0 || y >= WORLD_H) continue;
        if (x < 0 || x >= CHUNK_W) continue;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= 3 && chunkData[y][x] === BLOCK.AIR) chunkData[y][x] = BLOCK.LEAVES;
      }
    }
  }

  // ---------- Tile Helpers ----------
  function floorDiv(a, b) {
    // Proper floor division for negatives
    return Math.floor(a / b);
  }

  function mod(a, b) {
    // Proper modulo for negatives
    return ((a % b) + b) % b;
  }

  function getBlock(tx, ty) {
    if (ty < 0 || ty >= WORLD_H) return BLOCK.AIR;
    const cx = floorDiv(tx, CHUNK_W);
    const lx = mod(tx, CHUNK_W);
    const chunk = getChunk(cx);
    return chunk[ty][lx];
  }

  function setBlock(tx, ty, id) {
    if (ty < 0 || ty >= WORLD_H) return;
    const cx = floorDiv(tx, CHUNK_W);
    const lx = mod(tx, CHUNK_W);
    const chunk = getChunk(cx);
    chunk[ty][lx] = id;
  }

  function worldToTile(px, py) {
    return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) };
  }

  // ---------- Chunk Loading ----------
  function ensureChunksLoaded() {
    const playerTileX = Math.floor(player.x / TILE);
    const playerChunkX = floorDiv(playerTileX, CHUNK_W);

    for (let cx = playerChunkX - LOAD_RADIUS; cx <= playerChunkX + LOAD_RADIUS; cx++) {
      getChunk(cx);
    }

    // unload far chunks (keeps memory stable)
    for (const cx of chunks.keys()) {
      if (Math.abs(cx - playerChunkX) > LOAD_RADIUS + 2) {
        chunks.delete(cx);
      }
    }
  }

  // ---------- Collision ----------
  function rectHitsWorld(px, py, pw, ph) {
    const left = Math.floor(px / TILE);
    const right = Math.floor((px + pw - 1) / TILE);
    const top = Math.floor(py / TILE);
    const bottom = Math.floor((py + ph - 1) / TILE);

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        if (isSolid(getBlock(tx, ty))) return true;
      }
    }
    return false;
  }

  function moveAndCollide() {
    // Horizontal
    player.x += player.vx;
    if (rectHitsWorld(player.x, player.y, player.w, player.h)) {
      const step = Math.sign(player.vx) || 1;
      while (rectHitsWorld(player.x, player.y, player.w, player.h)) player.x -= step;
      player.vx = 0;
    }

    // Vertical
    player.y += player.vy;
    player.onGround = false;
    if (rectHitsWorld(player.x, player.y, player.w, player.h)) {
      const step = Math.sign(player.vy) || 1;
      while (rectHitsWorld(player.x, player.y, player.w, player.h)) player.y -= step;

      if (step > 0) player.onGround = true;
      player.vy = 0;
    }
  }

  // ---------- Survival ----------
  let hungerTimer = 0;
  function updateSurvival(dt) {
    const moving = Math.abs(player.vx) > 0.2;
    hungerTimer += dt * (moving ? 1.4 : 1.0);

    if (hungerTimer > 4.0) {
      hungerTimer = 0;
      player.hunger = Math.max(0, player.hunger - 1);
    }

    // regen
    if (player.hunger >= 16 && player.health < player.maxHealth) {
      if (Math.random() < 0.02) player.health = Math.min(player.maxHealth, player.health + 1);
    }

    // starvation
    if (player.hunger === 0) {
      if (Math.random() < 0.03) player.health = Math.max(0, player.health - 1);
    }

    if (player.health <= 0) respawn();
  }

  function respawn() {
    player.health = player.maxHealth;
    player.hunger = player.maxHunger;
    player.x = 2 * TILE;
    player.y = 10 * TILE;
    player.vx = 0;
    player.vy = 0;
  }

  // ---------- Inventory ----------
  function addToInventory(blockId, amount = 1) {
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

  // ---------- Mouse: Break/Place ----------
  function screenToWorld(mx, my) {
    return { wx: mx + camera.x, wy: my + camera.y };
  }

  function withinReach(tx, ty) {
    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    return Math.hypot(px - cx, py - cy) <= REACH;
  }

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { wx, wy } = screenToWorld(mx, my);
    const { tx, ty } = worldToTile(wx, wy);

    if (!withinReach(tx, ty)) return;

    if (e.button === 0) {
      // break
      const b = getBlock(tx, ty);
      if (b !== BLOCK.AIR) {
        setBlock(tx, ty, BLOCK.AIR);
        addToInventory(b, 1);
      }
    } else if (e.button === 2) {
      // place
      const slot = hotbar[selectedSlot];
      if (!slot || slot.count <= 0) return;
      if (getBlock(tx, ty) !== BLOCK.AIR) return;

      // prevent placing inside player
      const rx = tx * TILE, ry = ty * TILE;
      const overlaps =
        !(rx + TILE <= player.x ||
          rx >= player.x + player.w ||
          ry + TILE <= player.y ||
          ry >= player.y + player.h);

      if (overlaps) return;

      setBlock(tx, ty, slot.block);
      removeFromSelected(1);
    }
  });

  // ---------- Save/Load ----------
  const SAVE_KEY = "mc2d_save_v1";

  function serializeWorldWindow() {
    // Save only chunks around player (keeps storage small)
    const tileX = Math.floor(player.x / TILE);
    const centerChunk = floorDiv(tileX, CHUNK_W);
    const min = centerChunk - LOAD_RADIUS;
    const max = centerChunk + LOAD_RADIUS;

    const savedChunks = [];
    for (let cx = min; cx <= max; cx++) {
      const chunk = getChunk(cx);
      savedChunks.push([cx, chunk]);
    }

    return {
      v: 1,
      seed: SEED,
      player: {
        x: player.x, y: player.y,
        vx: player.vx, vy: player.vy,
        health: player.health, hunger: player.hunger
      },
      hotbar: hotbar.map(s => ({ block: s.block, count: s.count })),
      selectedSlot,
      chunks: savedChunks
    };
  }

  function saveGame() {
    try {
      const data = serializeWorldWindow();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      // quick visual feedback
      flashMessage("Saved ✅");
    } catch (err) {
      showError("Save failed:\n" + err);
    }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
