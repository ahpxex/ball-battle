/** Logical arena size in world units. The renderer scales this to the canvas. */
export const ARENA_SIZE = 600
export const BALL_RADIUS = 34
/** Cruise speed every ball returns to after being knocked around (units/s). */
export const BASE_SPEED = 300
/** How fast a ball's speed relaxes back to BASE_SPEED (1/s). */
export const SPEED_RECOVERY = 2.2
export const STARTING_HP = 100

/** Simulation runs on a fixed timestep for determinism. */
export const FIXED_DT = 1 / 120

/** Frozen pause before the fight starts (seconds). */
export const COUNTDOWN_DURATION = 1.1
/** Time the world keeps animating after a knockout before the result is final. */
export const ENDING_DURATION = 1.6

/** After this much fight time the arena starts draining both balls. */
export const OVERTIME_START = 90
export const OVERTIME_TICK = 0.5
