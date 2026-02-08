// ============================================================
// Level definitions for AR Flight Sim
// ============================================================

export const LEVELS = [
    {
        id: 1,
        name: 'First Flight',
        description: 'Learn the basics — 5 easy checkpoints',
        checkpointCount: 5,
        timeLimit: 90,
        courseRadius: 5,
        ringSize: 1.0,
        baseHeight: 1.5,
        heightVariation: 0.8,
        windSpeed: 0,
        windDirection: [0, 0, 0],
        turbulence: 0,
        requiredForUnlock: 0,
        starThresholds: [80, 50, 20],
    },
    {
        id: 2,
        name: 'Sky Rider',
        description: 'Higher and faster — 8 checkpoints',
        checkpointCount: 8,
        timeLimit: 80,
        courseRadius: 7,
        ringSize: 0.85,
        baseHeight: 2.0,
        heightVariation: 1.5,
        windSpeed: 0.5,
        windDirection: [1, 0, 0],
        turbulence: 0.1,
        requiredForUnlock: 1,
        starThresholds: [70, 40, 15],
    },
    {
        id: 3,
        name: 'Wind Walker',
        description: 'Battle the wind — 10 checkpoints',
        checkpointCount: 10,
        timeLimit: 70,
        courseRadius: 8,
        ringSize: 0.75,
        baseHeight: 2.5,
        heightVariation: 2.0,
        windSpeed: 1.5,
        windDirection: [0.7, 0.2, 0.7],
        turbulence: 0.3,
        requiredForUnlock: 2,
        starThresholds: [60, 30, 10],
    },
    {
        id: 4,
        name: 'Ace Pilot',
        description: 'Tight rings, strong gusts — 12 checkpoints',
        checkpointCount: 12,
        timeLimit: 65,
        courseRadius: 9,
        ringSize: 0.6,
        baseHeight: 3.0,
        heightVariation: 2.5,
        windSpeed: 2.5,
        windDirection: [-0.5, 0.3, 0.8],
        turbulence: 0.5,
        requiredForUnlock: 3,
        starThresholds: [55, 25, 8],
    },
    {
        id: 5,
        name: 'Top Gun',
        description: 'The ultimate challenge — 15 checkpoints',
        checkpointCount: 15,
        timeLimit: 60,
        courseRadius: 10,
        ringSize: 0.5,
        baseHeight: 3.5,
        heightVariation: 3.0,
        windSpeed: 3.0,
        windDirection: [0.6, -0.2, -0.8],
        turbulence: 0.8,
        requiredForUnlock: 4,
        starThresholds: [50, 20, 5],
    },
];

/**
 * Get all levels with their unlock status.
 */
export function getUnlockedLevels() {
    const completed = parseInt(localStorage.getItem('arflight_completed') || '0');
    return LEVELS.map((level, i) => ({
        ...level,
        unlocked: i <= completed,
    }));
}

/**
 * Mark a level as completed and unlock the next one.
 */
export function markLevelCompleted(levelId) {
    const current = parseInt(localStorage.getItem('arflight_completed') || '0');
    if (levelId > current) {
        localStorage.setItem('arflight_completed', levelId.toString());
    }
}

/**
 * Generate checkpoint positions for a given level config.
 */
export function generateCheckpointPositions(level) {
    const positions = [];
    const { checkpointCount, courseRadius, baseHeight, heightVariation } = level;

    for (let i = 0; i < checkpointCount; i++) {
        const angle = (i / checkpointCount) * Math.PI * 2;
        const radiusJitter = courseRadius + Math.sin(i * 1.3) * (courseRadius * 0.2);

        positions.push({
            x: Math.cos(angle) * radiusJitter,
            y: baseHeight + Math.sin(i * 0.7 + 0.5) * heightVariation,
            z: Math.sin(angle) * radiusJitter,
            nextAngle: ((i + 1) / checkpointCount) * Math.PI * 2,
        });
    }

    return positions;
}
