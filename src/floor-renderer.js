import { ASSETS } from './assets.js';
import { CONFIG } from './config.js';

export class FloorRenderer {
    constructor() {
        this.cachedTile = null;
    }

    invalidate() {
        this.cachedTile = null;
    }

    render(ctx, width, height, camX, camY, gridToScreenFn) {
        if (!ASSETS.loaded) return;

        const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;

        // Init cache if missing
        if (!this.cachedTile) {
            this.cachedTile = document.createElement('canvas');
            this.cachedTile.width = tileSize;
            this.cachedTile.height = tileSize;
            const fCtx = this.cachedTile.getContext('2d');
            const subSize = tileSize / 2;
            for (let oy = 0; oy < 2; oy++) {
                for (let ox = 0; ox < 2; ox++) {
                    fCtx.drawImage(ASSETS.floor, ox * subSize, oy * subSize, subSize, subSize);
                }
            }
        }

        // Render Loop
        const cullMargin = tileSize * 2;
        
        for (let y = 0; y < CONFIG.GRID_H; y++) {
            for (let x = 0; x < CONFIG.GRID_W; x++) {
                const pos = gridToScreenFn(x, y, camX, camY);
                
                if (
                    pos.x < -cullMargin ||
                    pos.x > width + cullMargin ||
                    pos.y < -cullMargin ||
                    pos.y > height + cullMargin
                ) continue;
                
                ctx.drawImage(this.cachedTile, pos.x, pos.y);
            }
        }
    }
}