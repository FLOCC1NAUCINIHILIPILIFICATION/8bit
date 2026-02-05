function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ensureChunksLoaded();
  updatePlayer();
  drawWorld();
  drawPlayer();

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
