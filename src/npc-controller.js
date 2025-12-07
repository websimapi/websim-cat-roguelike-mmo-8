export function updateNPCs(state, dt, localPlayer) {
    state.npcs.forEach(npc => {
        // 1. Find closest player (Local or Remote)
        let closestDist = Infinity;
        let targetPlayer = null;

        // Check Local
        const dLocal = Math.hypot(localPlayer.x - npc.x, localPlayer.y - npc.y);
        if (dLocal < closestDist) {
            closestDist = dLocal;
            targetPlayer = localPlayer;
        }

        // Check Peers
        Object.keys(state.players).forEach(id => {
            if (id === state.myId) return;
            const p = state.players[id];
            const d = Math.hypot(p.x - npc.x, p.y - npc.y);
            if (d < closestDist) {
                closestDist = d;
                targetPlayer = p;
            }
        });

        // 2. AI Logic
        const WATCH_DIST = 3.5;

        if (closestDist < WATCH_DIST && targetPlayer) {
            // Watch Mode (Look at player)
            npc.aiState = 'watch';
            npc.isMoving = false;
            npc.aiTimer = 1000;

            // Face target
            const dx = targetPlayer.x - npc.x;
            const dy = targetPlayer.y - npc.y;
            if (Math.abs(dx) > Math.abs(dy)) {
                npc.facing = dx > 0 ? 'right' : 'left';
            } else {
                npc.facing = dy > 0 ? 'down' : 'up';
            }
        } else {
            // Patrol Mode
            if (npc.aiState === 'watch') {
                npc.aiState = 'idle';
            }

            if (npc.aiState === 'idle') {
                npc.aiTimer -= dt * 1000; // Timer still in ms
                npc.isMoving = false;
                if (npc.aiTimer <= 0) {
                    npc.aiState = 'wander';
                    // Pick random spot in front of shop
                    const b = npc.patrolBounds;
                    npc.targetX = b.x1 + Math.random() * (b.x2 - b.x1);
                    npc.targetY = b.y1 + Math.random() * (b.y2 - b.y1);
                }
            } else if (npc.aiState === 'wander') {
                const speed = 0.9 * dt; // Slow leisurely walk (approx 0.9 tiles/sec)
                const dx = npc.targetX - npc.x;
                const dy = npc.targetY - npc.y;
                const dist = Math.hypot(dx, dy);

                if (dist < speed) {
                    npc.x = npc.targetX;
                    npc.y = npc.targetY;
                    npc.aiState = 'idle';
                    npc.aiTimer = 2000 + Math.random() * 3000;
                } else {
                    npc.x += (dx / dist) * speed;
                    npc.y += (dy / dist) * speed;
                    npc.isMoving = true;
                    
                    if (Math.abs(dx) > Math.abs(dy)) {
                        npc.facing = dx > 0 ? 'right' : 'left';
                    } else {
                        npc.facing = dy > 0 ? 'down' : 'up';
                    }
                }
            }
        }
    });
}