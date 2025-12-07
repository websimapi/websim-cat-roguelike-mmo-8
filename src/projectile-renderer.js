import { CONFIG } from './config.js';

export function drawProjectile(ctx, proj, screenX, screenY, tileSize) {
    const r = (CONFIG.PROJECTILE_RADIUS || 0.1) * tileSize;
    
    ctx.save();
    ctx.fillStyle = '#00ffff'; 
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';
    ctx.beginPath();
    ctx.arc(screenX + tileSize/2, screenY + tileSize/2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

