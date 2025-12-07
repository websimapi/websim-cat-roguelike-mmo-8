import { CONFIG } from './config.js';
import { ASSETS } from './assets.js';
import { drawCharacter } from './character-renderer.js';

export class ShadowRenderer {
    constructor(mainCanvas) {
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCtx = this.shadowCanvas.getContext('2d');
        this.resize(mainCanvas);
    }

    resize(mainCanvas) {
        this.shadowCanvas.width = mainCanvas.width;
        this.shadowCanvas.height = mainCanvas.height;

        if (this.shadowCtx) {
            this.shadowCtx.imageSmoothingEnabled = false;
        }
    }

    /**
     * Renders all ground shadows (characters + shop) into the shadow buffer,
     * composites them onto the main canvas, and returns the list of characters
     * whose shadows should also be drawn on top of the shop (highShadows).
     */
    renderGroundAndShopShadows(renderer, gameState, camX, camY, sx, sy, shadowOpacity) {
        const { canvas } = renderer;
        const ctx = renderer.ctx;
        const sCtx = this.shadowCtx;
        const { width, height } = canvas;
        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        const allChars = [];
        Object.values(gameState.players).forEach(p => allChars.push({ obj: p, isNpc: false }));
        gameState.npcs.forEach(npc => allChars.push({ obj: npc, isNpc: true }));

        const highShadows = [];

        // Shop Bounds for shadow casting (Visual Sprite is at row 3)
        const shopMinX = 2.5;
        const shopMaxX = 6.5;
        const shopBaseY = 4.0;

        // Only lift shadow if pointing NORTH (sy < 0) and Player is SOUTH of shop
        const shadowPointsNorth = sy < 0;

        // Determine which character shadows intersect the shop face
        if (shadowOpacity > 0.01 && shadowPointsNorth) {
            allChars.forEach(item => {
                const { obj } = item;

                if (obj.y > shopBaseY) {
                    const tipY = obj.y + sy; // shadow tip y

                    if (tipY < shopBaseY) {
                        const t = (shopBaseY - obj.y) / sy;
                        const ix = obj.x + t * sx;

                        if (ix > shopMinX && ix < shopMaxX) {
                            highShadows.push(item);
                        }
                    }
                }
            });
        }

        if (shadowOpacity <= 0.01) {
            return highShadows;
        }

        // Clear the shadow buffer
        sCtx.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);

        sCtx.save();
        sCtx.fillStyle = 'black';

        // A. Ground Character Shadows (Draw ALL)
        allChars.forEach(({ obj, isNpc }) => {
            const pos = renderer.gridToScreen(obj.x - 0.5, obj.y - 0.5, camX, camY);
            if (
                pos.x < -tileSize || 
                pos.x > width + tileSize || 
                pos.y < -tileSize || 
                pos.y > height + tileSize
            ) return;

            const feetOffset = tileSize * (25 / 32);
            const cx = pos.x + tileSize / 2;
            const pivotY = pos.y + feetOffset;

            sCtx.save();
            sCtx.translate(cx, pivotY);
            sCtx.transform(1, 0, -sx, -sy, 0, 0);
            drawCharacter(sCtx, obj, -tileSize / 2, -feetOffset, tileSize, isNpc, true);
            sCtx.restore();
        });

        // B. Shop Shadow (Always Ground)
        const shopPos = renderer.gridToScreen(3, 2, camX, camY);
        if (
            shopPos.x > -tileSize * 5 && shopPos.x < width + tileSize * 5 && 
            shopPos.y > -tileSize * 5 && shopPos.y < height + tileSize * 5
        ) {
            sCtx.save();
            sCtx.translate(shopPos.x + tileSize * 1.5, shopPos.y + tileSize * 2);
            sCtx.transform(1, 0, -sx, -sy, 0, 0);
            sCtx.drawImage(ASSETS.shop, -tileSize * 1.5, -tileSize * 2, tileSize * 3, tileSize * 2);
            sCtx.restore();
        }

        // Force silhouettes to pure black while preserving alpha
        sCtx.globalCompositeOperation = 'source-in';
        sCtx.fillRect(0, 0, width, height);

        sCtx.restore();

        // Composite Ground Shadows to Main Canvas
        ctx.save();
        ctx.globalAlpha = shadowOpacity;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this.shadowCanvas, 0, 0);
        ctx.restore();

        return highShadows;
    }

    /**
     * Renders all high (on-top-of-shop) shadows as a single flattened batch
     * onto the main canvas using the internal shadow buffer.
     */
    renderHighShadowsBatch(renderer, items, opacity, sx, sy, camX, camY) {
        if (!items || !items.length || opacity <= 0.01) return;

        const { canvas } = renderer;
        const ctx = renderer.ctx;
        const sCtx = this.shadowCtx;
        const { width, height } = canvas;
        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        // Clear buffer
        sCtx.clearRect(0, 0, width, height);

        sCtx.save();
        sCtx.fillStyle = 'black';
        sCtx.globalAlpha = 1.0;

        // Draw character silhouettes into buffer
        items.forEach(({ obj, isNpc }) => {
            const pos = renderer.gridToScreen(obj.x - 0.5, obj.y - 0.5, camX, camY);
            if (
                pos.x < -tileSize || 
                pos.x > width + tileSize || 
                pos.y < -tileSize || 
                pos.y > height + tileSize
            ) return;

            const feetOffset = tileSize * (25 / 32);
            const cx = pos.x + tileSize / 2;
            const pivotY = pos.y + feetOffset;

            sCtx.save();
            sCtx.translate(cx, pivotY);
            sCtx.transform(1, 0, -sx, -sy, 0, 0);
            drawCharacter(sCtx, obj, -tileSize / 2, -feetOffset, tileSize, isNpc, true);
            sCtx.restore();
        });

        // Force silhouettes to black
        sCtx.globalCompositeOperation = 'source-in';
        sCtx.fillRect(0, 0, width, height);

        // Mask with Shop sprite so these shadows only appear on the shop
        sCtx.globalCompositeOperation = 'destination-in';
        const shopPos = renderer.gridToScreen(3, 2, camX, camY);
        sCtx.drawImage(ASSETS.shop, shopPos.x, shopPos.y, tileSize * 3, tileSize * 2);

        sCtx.restore();

        // Composite onto main canvas
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this.shadowCanvas, 0, 0);
        ctx.restore();
    }
}