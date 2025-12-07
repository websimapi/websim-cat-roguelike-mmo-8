import { CONFIG, MAP_DATA } from './config.js';
import { ASSETS } from './assets.js';
import { drawCharacter } from './character-renderer.js';
import { drawWall, drawGateOverlay } from './wall-renderer.js';
import { ShadowRenderer } from './shadow-renderer.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // removed inline shadowCanvas/shadowCtx; now managed by ShadowRenderer
        this.shadowRenderer = new ShadowRenderer(this.canvas);

        // Reusable bucket arrays to reduce GC
        this.entitiesByRow = Array.from({ length: CONFIG.GRID_H }, () => []);
        
        this.cachedFloor = null;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        
        // Only force rotate for Phones (width < 760px in portrait), not Tablets
        const isPhonePortrait = h > w && w < 760;

        // When in phone portrait we rotate the game-container 90deg via CSS.
        // Make the canvas match the rotated landscape area (use the larger dimension as width).
        if (isPhonePortrait) {
            this.canvas.width = h;
            this.canvas.height = w;
        } else {
            this.canvas.width = w;
            this.canvas.height = h;
        }

        // removed direct shadowCanvas resize; ShadowRenderer handles its own buffer sizing
        this.shadowRenderer.resize(this.canvas);

        this.ctx.imageSmoothingEnabled = false;
        
        // Invalidate floor cache on resize as tilesize might change (if we supported dynamic zoom, currently hardcoded scale)
        this.cachedFloor = null;
    }

    // Helper to convert grid coords to screen pixels
    gridToScreen(gx, gy, camX, camY) {
        const centerScreenX = this.canvas.width / 2;
        const centerScreenY = this.canvas.height / 2;
        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        // Round to nearest pixel to prevent texture crawling/shimmering
        const screenX = Math.floor(centerScreenX + (gx - camX) * tileSize);
        const screenY = Math.floor(centerScreenY + (gy - camY) * tileSize);
        
        return { x: screenX, y: screenY, size: tileSize };
    }

    render(gameState, localPlayerId, time) {
        const ctx = this.ctx;
        const { width, height } = this.canvas;
        
        // Clear
        ctx.clearRect(0, 0, width, height);

        if (!ASSETS.loaded) return;

        // Camera follows local player
        let camX = CONFIG.GRID_W / 2;
        let camY = CONFIG.GRID_H / 2;
        
        if (gameState.players[localPlayerId]) {
            const p = gameState.players[localPlayerId];
            camX = p.x;
            camY = p.y;
        }

        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;
        const gateX = 11; // 11th grid tile (Center of 23)

        // --- Day/Night Cycle Calc ---
        const dayProgress = (time % CONFIG.DAY_LENGTH) / CONFIG.DAY_LENGTH; // 0 to 1
        
        // Sun Elevation (-1 at midnight, 1 at noon)
        // 0.25 (Sunrise) -> 0
        // 0.50 (Noon) -> 1
        // 0.75 (Sunset) -> 0
        const elevation = Math.sin(dayProgress * Math.PI * 2 - Math.PI / 2);

        // Sun Azimuth (Rotation around Z)
        // 0.25 (Sunrise) -> East (PI)
        // 0.50 (Noon) -> South (3PI/2) -- shadows point North
        // 0.75 (Sunset) -> West (0)
        const sunAngle = (dayProgress - 0.25) * Math.PI * 2; 

        let shadowLen = 0;
        let shadowOpacity = 0;
        let ambientLight = 0.2; // Min brightness

        if (elevation > 0) {
            // Day
            shadowLen = 1.0 / Math.max(0.1, elevation);
            shadowLen = Math.min(shadowLen, 3.0); // Clamp length
            
            shadowOpacity = 0.4 * Math.min(1, elevation * 3); // Fade shadow near horizon
            
            // Brightness peaks at noon
            ambientLight = 0.2 + 0.8 * Math.sin(dayProgress * Math.PI); 
        }

        // Shadow Vector (Opposite to Sun)
        const shadowDir = sunAngle + Math.PI;
        const sx = Math.cos(shadowDir) * shadowLen;
        const sy = Math.sin(shadowDir) * shadowLen;

        // Create cached floor tile if needed
        if (!this.cachedFloor && ASSETS.loaded) {
            this.cachedFloor = document.createElement('canvas');
            this.cachedFloor.width = tileSize;
            this.cachedFloor.height = tileSize;
            const fCtx = this.cachedFloor.getContext('2d');
            const subSize = tileSize / 2;
            for (let oy = 0; oy < 2; oy++) {
                for (let ox = 0; ox < 2; ox++) {
                    fCtx.drawImage(ASSETS.floor, ox * subSize, oy * subSize, subSize, subSize);
                }
            }
        }

        // 1. Draw ALL Floors First (Background Layer)
        const floorCullMarginX = tileSize * 2;
        const floorCullMarginY = tileSize * 2;
        for (let y = 0; y < CONFIG.GRID_H; y++) {
            for (let x = 0; x < CONFIG.GRID_W; x++) {
                const pos = this.gridToScreen(x, y, camX, camY);
                if (
                    pos.x < -floorCullMarginX ||
                    pos.x > width + floorCullMarginX ||
                    pos.y < -floorCullMarginY ||
                    pos.y > height + floorCullMarginY
                ) continue;
                
                if (this.cachedFloor) {
                    this.ctx.drawImage(this.cachedFloor, pos.x, pos.y);
                }
            }
        }

        // 1.25 Draw Background Walls (North Walls & Vestibule Pillars)
        // These need to be drawn BEFORE the shadow pass so shadows can be cast ONTO them.
        
        // Draw Vestibule Pillars FIRST (y=1) so the main North Wall (y=0) covers them
        // This fixes the "interior wall z-index too high" issue
        drawWall(this, gateX - 1, 1, camX, camY);
        drawWall(this, gateX + 1, 1, camX, camY);

        // Draw North Walls (y=0) SECOND
        for (let x = 0; x < CONFIG.GRID_W; x++) {
            if (MAP_DATA[0][x] === 1) {
                drawWall(this, x, 0, camX, camY);
            }
        }

        // 1.5 Unified Shadow Pass (delegated to ShadowRenderer)
        let highShadows = [];
        if (shadowOpacity > 0.01) {
            highShadows = this.shadowRenderer.renderGroundAndShopShadows(
                this,
                gameState,
                camX,
                camY,
                sx,
                sy,
                shadowOpacity
            );
        }

        // 2. Unified Depth-Sorted Render Pass (Walls, Entities, Shop)
        const renderList = [];

        // Add Map Walls
        for (let y = 0; y < CONFIG.GRID_H; y++) {
            for (let x = 0; x < CONFIG.GRID_W; x++) {
                if (MAP_DATA[y][x] === 1) {
                    const isNorthVestibule = (y === 1 && (x === gateX - 1 || x === gateX + 1));

                    // Skip background walls (already drawn)
                    if (y === 0 || isNorthVestibule) continue;

                    renderList.push({
                        type: 'wall',
                        x: x,
                        y: y,
                        depth: y + 0.1 
                    });
                }
            }
        }
        
        // Add South Vestibule Pillars
        const southVestibuleY = CONFIG.GRID_H;
        const southVestibuleDepth = CONFIG.GRID_H - 1.5;
        renderList.push({ type: 'wall', x: gateX - 1, y: southVestibuleY, depth: southVestibuleDepth });
        renderList.push({ type: 'wall', x: gateX + 1, y: southVestibuleY, depth: southVestibuleDepth });

        // Add Shop & Shop Shadow
        // Shop visual base is at row 3 (grid y=2, h=2, bottom=4 in grid logic but visual anchor)
        // Visual sorting: Shop stands at Y=3 approx.
        const shopDepth = 3.1;
        renderList.push({ type: 'shop', depth: shopDepth });
        
        // Add High Shadows (Cast on top of Shop) - Batched to prevent overlapping opacity artifacts
        if (shadowOpacity > 0.01 && highShadows.length > 0) {
            renderList.push({
                type: 'high_shadows_batch',
                items: highShadows,
                depth: 3.15, 
                opacity: shadowOpacity,
                sx: sx,
                sy: sy
            });
        }

        // Add Characters
        const allChars = [];
        Object.values(gameState.players).forEach(p => allChars.push({ obj: p, isNpc: false }));
        gameState.npcs.forEach(npc => allChars.push({ obj: npc, isNpc: true }));

        let localPlayerInNorthGate = false;

        allChars.forEach(({ obj, isNpc }) => {
            let sortDepth = obj.y;
            
            // Side Walls Fix
            if ((obj.x < 2.5 || obj.x > CONFIG.GRID_W - 2.5) && obj.y > 2.0) {
                 sortDepth = obj.y - 1.5;
            }

            // North Gate Fix
            const gateX = Math.floor(CONFIG.GRID_W / 2);
            const inNorthGate = (obj.y < 0.9) && (Math.abs(obj.x - gateX) < 1.5);
            if (inNorthGate) {
                sortDepth = -5; 
            }

            if (obj.id === localPlayerId && inNorthGate) {
                localPlayerInNorthGate = true;
            }

            // South Gate Fix
            const southGateY = CONFIG.GRID_H - 1;
            const inSouthGate = (obj.y > southGateY - 0.5) && (Math.abs(obj.x - gateX) < 1.5);
            if (inSouthGate) {
                sortDepth = southGateY - 0.5;
            }

            renderList.push({ type: 'character', obj: obj, depth: sortDepth, isNpc: isNpc });
        });

        // Add Projectiles
        gameState.projectiles.forEach(p => {
            renderList.push({ type: 'projectile', obj: p, depth: p.y });
        });

        // Sort by depth (Low Y -> High Y)
        renderList.sort((a, b) => a.depth - b.depth);

        // Execute Draw
        renderList.forEach(item => {
            if (item.type === 'wall') {
                drawWall(this, item.x, item.y, camX, camY);

            } else if (item.type === 'shop') {
                const shopPos = this.gridToScreen(3, 2, camX, camY);
                ctx.drawImage(ASSETS.shop, shopPos.x, shopPos.y, tileSize * 3, tileSize * 2);

            } else if (item.type === 'character') {
                const pos = this.gridToScreen(item.obj.x - 0.5, item.obj.y - 0.5, camX, camY);
                drawCharacter(ctx, item.obj, pos.x, pos.y, tileSize, item.isNpc);

            } else if (item.type === 'projectile') {
                this.drawProjectile(ctx, item.obj, camX, camY, tileSize);

            } else if (item.type === 'high_shadows_batch') {
                // removed inline high shadow batch logic; now delegated to ShadowRenderer
                this.shadowRenderer.renderHighShadowsBatch(
                    this,
                    item.items,
                    item.opacity,
                    item.sx,
                    item.sy,
                    camX,
                    camY
                );
            }
        });

        // 3. Gate Overlay (North Gate)
        // Draws the arch/roof of the gate ON TOP of the player when they are walking through it.
        // This ensures the player appears "under" or "inside" the gate structure.
        if (localPlayerInNorthGate) {
            drawGateOverlay(this, 0, camX, camY);
        }

        // 4. Night Overlay (Post-Render)
        if (ambientLight < 0.99) {
            ctx.fillStyle = `rgba(0, 5, 20, ${1.0 - ambientLight})`;
            ctx.fillRect(0, 0, width, height);
        }
    }

    drawProjectile(ctx, proj, camX, camY, tileSize) {
        const pos = this.gridToScreen(proj.x - 0.5, proj.y - 0.5, camX, camY);
        const r = (CONFIG.PROJECTILE_RADIUS || 0.1) * tileSize;
        ctx.fillStyle = '#00ffff'; 
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00ffff';
        ctx.beginPath();
        ctx.arc(pos.x + tileSize/2, pos.y + tileSize/2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}