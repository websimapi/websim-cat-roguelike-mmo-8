import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { CONFIG, MAP_DATA } from './config.js';
import { ASSETS, loadAssets, playSound } from './assets.js';
import { interactWithNPC, closeChat } from './ai.js';
import { checkCollision, spawnProjectile, updateProjectiles } from './physics.js';
import { updateNPCs } from './npc-controller.js';

const room = new WebsimSocket();

const state = {
    players: {}, // Stores interpolated player states
    npcs: [
        { 
            id: 'npc_shop', 
            x: 4.5, 
            y: 4.5, 
            canTalk: true, 
            facing: 'down',
            // AI State
            aiState: 'idle',
            aiTimer: 0,
            targetX: 4.5,
            targetY: 4.5,
            patrolBounds: { x1: 2.5, x2: 6.5, y1: 4.5, y2: 6.5 }
        }
    ],
    projectiles: [],
    myId: null,
    lastUpdate: 0,
    // Default fixed time: 3 minutes into the day (in seconds).
    // This can be overridden via settings.json -> timeOfDaySeconds.
    time: 180
};

// Logic for local player
const localPlayer = {
    x: 10.5,
    y: 5.5,
    vx: 0,
    vy: 0,
    facing: 'right',
    aimAngle: 0, // NEW: precise aiming
    lastShot: 0,
    talking: false,
    hitAnim: null,
    isMoving: false,
    wasMoving: false
};

let renderer;
let animationFrame;
let lastTime = 0;

// Load external game settings (e.g. time of day)
async function loadSettings() {
    try {
        const res = await fetch('settings.json', { cache: 'no-cache' });
        if (!res.ok) return;
        const json = await res.json();

        if (typeof json.timeOfDaySeconds === 'number') {
            state.time = json.timeOfDaySeconds;
        }
    } catch (e) {
        console.warn('Failed to load settings.json, using defaults:', e);
    }
}

// NEW: helper to update facing based on current mouse position
function updateFacingFromMouse() {
    if (!Input.mouse.moved || !renderer) return;

    const tileSize = CONFIG.TILE_SIZE * CONFIG.SCALE;
    // Player is always rendered at screen center
    const originX_Screen = renderer.canvas.width / 2;
    const originY_Screen = renderer.canvas.height / 2;

    const dx = Input.mouse.x - originX_Screen;
    const dy = Input.mouse.y - originY_Screen;

    localPlayer.aimAngle = Math.atan2(dy, dx); // Update aim angle

    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;

    if (Math.abs(dx) > Math.abs(dy)) {
        localPlayer.facing = dx > 0 ? 'right' : 'left';
    } else {
        localPlayer.facing = dy > 0 ? 'down' : 'up';
    }
}

async function init() {
    const canvas = document.getElementById('gameCanvas');
    renderer = new Renderer(canvas);
    Input.init(canvas);

    await loadAssets();
    await loadSettings();
    await room.initialize();

    state.myId = room.clientId;
    document.getElementById('loading').style.display = 'none';

    // Initial spawn presence
    room.updatePresence({
        x: localPlayer.x,
        y: localPlayer.y,
        facing: localPlayer.facing,
        aimAngle: localPlayer.aimAngle,
        isMoving: false,
        lastSeq: 0
    });

    // Subscribe to updates
    room.subscribePresence((presence) => {
        // Sync other players
        for (const id in presence) {
            if (id === state.myId) continue;
            const p = presence[id];

            // Simple interpolation target setup
            if (!state.players[id]) {
                state.players[id] = { ...p, id, username: room.peers[id]?.username || "Cat" };
            } else {
                // Update target values
                state.players[id].targetX = p.x;
                state.players[id].targetY = p.y;
                state.players[id].facing = p.facing;
                state.players[id].aimAngle = p.aimAngle || 0; // Sync aim
                state.players[id].isMoving = p.isMoving;
            }
        }

        // Remove disconnected
        for (const id in state.players) {
            if (!presence[id]) delete state.players[id];
        }
    });

    // Handle projectile events
    room.onmessage = (e) => {
        if (e.data.type === 'shoot') {
            // Prevent duplicate projectile for local player (since we spawn it immediately on input)
            if (e.data.ownerId === state.myId) return;

            spawnProjectile(state, e.data.x, e.data.y, e.data.dx, e.data.dy, e.data.ownerId);
            playSound('shoot', 0.3); // remote sound
        }
    };

    requestAnimationFrame(gameLoop);
}

function updateLocalPlayer(dt) {
    // Moved the "frozen" check deeper to allow interaction updates to run
    const isFrozen = localPlayer.talking;

    if (!isFrozen) {
        const move = Input.getMovementVector();
        // Speed is now time-based
        const speed = CONFIG.PLAYER_SPEED * dt;

        let nextX = localPlayer.x + move.x * speed;
        let nextY = localPlayer.y + move.y * speed;

        const margin = 0.3; // Hitbox radius roughly
        
        // Inline collision check removed, replaced with shared physics function
        const canMoveTo = (x, y) => {
            // Check all 4 corners of the hitbox
            if (checkCollision(x - margin, y - margin)) return false;
            if (checkCollision(x + margin, y + margin)) return false;
            if (checkCollision(x + margin, y - margin)) return false;
            if (checkCollision(x - margin, y + margin)) return false;
            return true;
        };

        if (canMoveTo(nextX, localPlayer.y)) {
            localPlayer.x = nextX;
        }

        if (canMoveTo(localPlayer.x, nextY)) {
            localPlayer.y = nextY;
        }

        if (move.y < 0) {
            localPlayer.facing = 'up';
        } else if (move.x !== 0) {
            localPlayer.facing = move.x > 0 ? 'right' : 'left';
        } else if (move.y > 0) {
            localPlayer.facing = 'down';
        }

        const isMoving = (move.x !== 0 || move.y !== 0);
        localPlayer.isMoving = isMoving; // Store locally for immediate rendering updates

        // Aim behavior:
        // 1. If shooting, aim at cursor (strafe).
        // 2. If moving and NOT shooting, look/aim in movement direction.
        // 3. If idle, look at cursor.
        if (Input.isShooting()) {
            updateFacingFromMouse();
        } else if (isMoving) {
            localPlayer.aimAngle = Math.atan2(move.y, move.x);
        } else {
            updateFacingFromMouse();
        }
    }

    // Network Sync (Throttle to ~20hz)
    const now = Date.now();
    const movingChanged = localPlayer.isMoving !== localPlayer.wasMoving;

    if (now - state.lastUpdate > 50) {
        // Send update if: moving, state changed (stopped/started), or heartbeat needed
        if (localPlayer.isMoving || movingChanged || now - state.lastUpdate > 1000) {
            room.updatePresence({
                x: localPlayer.x,
                y: localPlayer.y,
                facing: localPlayer.facing,
                aimAngle: localPlayer.aimAngle,
                isMoving: localPlayer.isMoving
            });
            state.lastUpdate = now;
            localPlayer.wasMoving = localPlayer.isMoving;
        }
    }

    // Shooting
    // FIRE_RATE is now in seconds
    if (!isFrozen && Input.isShooting() && (now/1000) - localPlayer.lastShot > CONFIG.FIRE_RATE) {
        localPlayer.lastShot = now/1000;

        // Use aimAngle for shooting
        const angle = localPlayer.aimAngle;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        // Calculate Muzzle Position
        const offsetDist = 0.5;
        const muzzleX = localPlayer.x + dx * offsetDist;
        const muzzleY = localPlayer.y + dy * offsetDist;

        spawnProjectile(state, muzzleX, muzzleY, dx, dy, state.myId);
        playSound('shoot');

        room.send({
            type: 'shoot',
            x: muzzleX,
            y: muzzleY,
            dx: dx,
            dy: dy,
            ownerId: state.myId
        });
    }

    // Interaction Check
    let nearbyNPC = null;
    state.npcs.forEach(npc => {
        const dist = Math.hypot(npc.x - localPlayer.x, npc.y - localPlayer.y);
        if (dist < 1.5) nearbyNPC = npc;
    });

    const prompt = document.getElementById('interaction-label');
    if (nearbyNPC) {
        // Only show prompt if not currently talking
        if (!localPlayer.talking) {
            prompt.style.display = 'block';
            const screenPos = renderer.gridToScreen(nearbyNPC.x, nearbyNPC.y, localPlayer.x, localPlayer.y);
            prompt.style.left = screenPos.x + 'px';
            prompt.style.top = (screenPos.y - 40) + 'px';

            if (Input.keys['KeyT'] || Input.keys['t']) {
                localPlayer.talking = true;
                Input.keys['KeyT'] = false;
                Input.keys['t'] = false; // consume
                prompt.style.display = 'none';
                interactWithNPC(nearbyNPC, () => {
                    localPlayer.talking = false;
                });
            }
        } else {
            prompt.style.display = 'none';
        }
    } else {
        prompt.style.display = 'none';
    }

    // Mouse click interaction fallback
    if (!localPlayer.talking && Input.mouse.leftDown && nearbyNPC) {
        localPlayer.talking = true;
        Input.mouse.leftDown = false;
        interactWithNPC(nearbyNPC, () => {
             localPlayer.talking = false;
        });
    }
}

function updatePeers() {
    // Smoothly interpolate other players
    for (const id in state.players) {
        const p = state.players[id];
        if (p.targetX !== undefined) {
            p.x += (p.targetX - p.x) * 0.2;
            p.y += (p.targetY - p.y) * 0.2;
        }
    }
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    // Calculate Delta Time in seconds
    // Cap dt at 0.1s (10FPS) to prevent physics explosions on lag spikes/tab switching
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    // Keep time fixed; no day/night cycling
    // state.time remains constant so sun/shadows don't move

    updateLocalPlayer(dt);
    updatePeers(); // Interpolation doesn't strictly need dt as it's a dampening factor, but could be improved. Leaving as is for simple smoothing.
    
    // NPC updates moved to npc-controller.js
    updateNPCs(state, dt, localPlayer);
    
    // Projectile updates moved to physics.js
    updateProjectiles(state, dt, localPlayer);

    // Sync local player to state for rendering
    state.players[state.myId] = {
        ...localPlayer, 
        id: state.myId, 
        username: room.peers[state.myId]?.username || 'Me' 
    };

    renderer.render(state, state.myId, state.time);
    animationFrame = requestAnimationFrame(gameLoop);
}

// Start
init();