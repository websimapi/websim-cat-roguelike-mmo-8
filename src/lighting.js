import { CONFIG } from './config.js';

export function calculateLighting(time) {
    const dayProgress = (time % CONFIG.DAY_LENGTH) / CONFIG.DAY_LENGTH;
    const elevation = Math.sin(dayProgress * Math.PI * 2 - Math.PI / 2);
    const sunAngle = (dayProgress - 0.25) * Math.PI * 2;

    let shadowLen = 0;
    let shadowOpacity = 0;
    let ambientLight = 0.2;

    if (elevation > 0) {
        // Day
        shadowLen = 1.0 / Math.max(0.1, elevation);
        shadowLen = Math.min(shadowLen, 3.0);
        
        shadowOpacity = 0.4 * Math.min(1, elevation * 3);
        
        ambientLight = 0.2 + 0.8 * Math.sin(dayProgress * Math.PI); 
    }

    const shadowDir = sunAngle + Math.PI;
    const sx = Math.cos(shadowDir) * shadowLen;
    const sy = Math.sin(shadowDir) * shadowLen;

    return { sx, sy, shadowOpacity, ambientLight };
}

