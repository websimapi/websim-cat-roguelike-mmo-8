import { CONFIG } from './config.js';
import { ASSETS } from './assets.js';
import { drawCharacter } from './character-renderer.js';

export class ShadowRenderer {
    constructor(width, height) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize(width, height);
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Identifies which characters are casting shadows onto the shop face.
     */
    calculateHighShadows(gameState, sx, sy) {
        const highShadows = [];
        const shopMinX = 2.5;
        const shopMaxX = 6.5;
        const shopBaseY = 4.0;
        
        // Only valid if shadow points North (sy < 0)
        if (sy >= 0) return highShadows;

        const allChars = [
            ...Object.values(gameState.players).map(p => ({ obj: p, isNpc: false })),
            ...gameState.npcs.map(n => ({ obj: n, isNpc: true }))
        ];

        allChars.forEach(item => {
            const { obj } = item;
            if (obj.y > shopBaseY) {
                const tipY = obj.y + sy; 
                // Check intersection
                if (tipY < shopBaseY) {
                    const t = (shopBaseY - obj.y) / sy;
                    const ix = obj.x + t * sx;
                    if (ix > shopMinX && ix < shopMaxX) {
                        highShadows.push(item);
                    }
                }
            }
        });
        return highShadows;
    }

    /**
     * Renders normal ground shadows (characters + shop)
     */
    drawGroundShadows(ctx, gameState, sx, sy, opacity, gridToScreenFn) {
        if (opacity <= 0.01) return;

        const { width, height } = this.canvas;
        const sCtx = this.ctx;
        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        // Clear buffer
        sCtx.clearRect(0, 0, width, height);
        sCtx.save();
        sCtx.fillStyle = 'black';

        // 1. Characters
        const allChars = [
            ...Object.values(gameState.players).map(p => ({ obj: p, isNpc: false })),
            ...gameState.npcs.map(n => ({ obj: n, isNpc: true }))
        ];

        allChars.forEach(({ obj, isNpc }) => {
            const pos = gridToScreenFn(obj.x - 0.5, obj.y - 0.5);
            if (pos.x < -tileSize || pos.x > width + tileSize || pos.y < -tileSize || pos.y > height + tileSize) return;

            const feetOffset = tileSize * (25/32); 
            const cx = pos.x + tileSize / 2;
            const pivotY = pos.y + feetOffset;

            sCtx.save();
            sCtx.translate(cx, pivotY);
            sCtx.transform(1, 0, -sx, -sy, 0, 0);
            drawCharacter(sCtx, obj, -tileSize/2, -feetOffset, tileSize, isNpc, true);
            sCtx.restore();
        });

        // 2. Shop Shadow
        const shopPos = gridToScreenFn(3, 2);
        if (shopPos.x > -tileSize * 5 && shopPos.x < width + tileSize * 5 && 
            shopPos.y > -tileSize * 5 && shopPos.y < height + tileSize * 5) {
            sCtx.save();
            sCtx.translate(shopPos.x + tileSize * 1.5, shopPos.y + tileSize * 2);
            sCtx.transform(1, 0, -sx, -sy, 0, 0);
            sCtx.drawImage(ASSETS.shop, -tileSize * 1.5, -tileSize * 2, tileSize * 3, tileSize * 2);
            sCtx.restore();
        }

        // Flatten to pure silhouette
        sCtx.globalCompositeOperation = 'source-in';
        sCtx.fillRect(0, 0, width, height);
        sCtx.restore();

        // Composite to main canvas
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'multiply'; 
        ctx.drawImage(this.canvas, 0, 0);
        ctx.restore();
    }

    /**
     * Renders the batch of shadows that fall onto the shop face.
     */
    drawHighShadowBatch(ctx, items, sx, sy, opacity, gridToScreenFn) {
        if (items.length === 0 || opacity <= 0.01) return;

        const { width, height } = this.canvas;
        const sCtx = this.ctx;
        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        sCtx.clearRect(0, 0, width, height);
        sCtx.save();
        sCtx.fillStyle = 'black';
        sCtx.globalAlpha = 1.0;

        items.forEach(({ obj, isNpc }) => {
            const pos = gridToScreenFn(obj.x - 0.5, obj.y - 0.5);
            if (pos.x < -tileSize || pos.x > width + tileSize || pos.y < -tileSize || pos.y > height + tileSize) return;

            const feetOffset = tileSize * (25/32); 
            const cx = pos.x + tileSize / 2;
            const pivotY = pos.y + feetOffset;

            sCtx.save();
            sCtx.translate(cx, pivotY);
            sCtx.transform(1, 0, -sx, -sy, 0, 0);
            drawCharacter(sCtx, obj, -tileSize/2, -feetOffset, tileSize, isNpc, true);
            sCtx.restore();
        });

        // Force to black silhouette
        sCtx.globalCompositeOperation = 'source-in';
        sCtx.fillRect(0, 0, width, height);

        // MASK WITH SHOP SPRITE
        sCtx.globalCompositeOperation = 'destination-in';
        const shopPos = gridToScreenFn(3, 2);
        sCtx.drawImage(ASSETS.shop, shopPos.x, shopPos.y, tileSize * 3, tileSize * 2);

        sCtx.restore();

        // Composite the flattened shadows onto the main canvas with single uniform opacity
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'multiply'; 
        ctx.drawImage(this.canvas, 0, 0);
        ctx.restore();
    }
}