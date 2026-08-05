/**
 * Stable Studio-facing contract for the Runtime-owned notification sound engine.
 *
 * The built-in sounds are synthesized in the browser by Runtime oscillator
 * definitions, so the authoritative list of sound ids lives in the Runtime
 * module. Studio must read `BUILTIN_SOUND_NAMES` instead of restating the ids:
 * a hardcoded copy silently drifts from what the Runtime can actually play.
 */

/** Ids of every built-in sound the Runtime can synthesize, in Runtime order. */
export declare const BUILTIN_SOUND_NAMES: string[];

/** Play a built-in sound by id. Unknown ids are ignored by the Runtime. */
export declare function playBuiltinSound(name: string): void;
