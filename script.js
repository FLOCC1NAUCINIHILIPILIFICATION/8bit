const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game variables
const blockSize = 32; // Size of each block in pixels
const worldWidth = 25; // Number of blocks wide
const worldHeight = 18; // Number of blocks high

// World representation (2D array)
let world = [];

// Player variables
let playerX = 0;
let playerY = 0;
const playerColor = 'red';
const playerSize = blockSize - 4;

// Initialize the world with dirt (example)
function initializeWorld() {
  for (let y = 0; y < worldHeight; y++) {
    world[y] = [];
    for (let x = 0; x < worldWidth; x++) {
      world[y][x] = 'dirt'; // Or 'air', 'stone', etc.
    }
  }
}

// Draw a block
function drawBlock(x, y, blockType) {
  let color;
  switch (blockType) {
    case 'dirt': color = '#8B4513'; break;
    case 'stone': color = '#A9A9A9'; break;
    case 'air': color = 'transparent'; break; // Important for empty space
    default: color = '#FFFFFF'; // Default to white
  }

  ctx.fillStyle = color;
  ctx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
  ctx.strokeStyle = '#333'; // Block outlines
  ctx.strokeRect(x * blockSize, y * blockSize, blockSize, blockSize);
}

// Draw the player
function drawPlayer() {
  ctx.fillStyle = playerColor;
  ctx.fillRect(playerX * blockSize + (blockSize - playerSize) / 2, playerY * blockSize + (blockSize - playerSize) / 2, playerSize, playerSize);
}

// Game loop
function gameLoop() {
  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the world
  for (let y = 0; y < worldHeight; y++) {
    for (let x = 0; x < worldWidth; x++) {
      drawBlock(x, y, world[y][x]);
    }
  }

  // Draw the player
  drawPlayer();

  // Request the next frame
  requestAnimationFrame(gameLoop);
}

// Input handling (example - basic arrow key movement)
document.addEventListener('keydown', (event) => {
  const speed = 1; // Movement speed
  switch (event.key) {
    case 'ArrowLeft': playerX -= speed; break;
    case 'ArrowRight': playerX += speed; break;
    case 'ArrowUp': playerY -= speed; break;
    case 'ArrowDown': playerY += speed; break;
  }

  // Keep player within world bounds (basic)
  playerX = Math.max(0, Math.min(playerX, worldWidth - 1));
  playerY = Math.max(0, Math.min(playerY, worldHeight - 1));
});


// Start the game
initializeWorld();
gameLoop();
