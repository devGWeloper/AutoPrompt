/**
 * Page content width cap, shared by every screen so the top bar, the tab strip
 * and the content below stay on the same left/right edges.
 *
 * These pages are dense tables and side-by-side comparisons; letting a row span
 * a whole ultrawide monitor makes it hard to track across, and the eye has to
 * travel the full width for every case. 96rem (1536px) matches Tailwind's `2xl`
 * breakpoint, so nothing changes on laptops — it only bites on wide displays.
 */
export const SHELL = 'mx-auto w-full max-w-[96rem]';
