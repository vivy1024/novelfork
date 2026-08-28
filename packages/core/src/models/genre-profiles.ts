/**
 * Narrow re-export for `@vivy1024/novelfork-core/models/genre-profiles`.
 *
 * Consumers never want the whole novelfork-core barrel — bundling via Studio
 * would fail on node-specific peers. This module intentionally only re-exports
 * the bundled genre profiles snapshot, nothing else.
 */

export { BUNDLED_GENRE_PROFILES, type BundledGenreProfile } from "./bundled-genre-profiles.generated.js";
