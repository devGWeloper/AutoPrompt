const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An ISO8601 instant (GitLab `committed_date`, offset included) as a
 * 'YYYY-MM-DD HH24:MI:SS' wall-clock string in THIS server's local time.
 *
 * PTX_RUN_MAS.START_TM is a TIMESTAMP without zone holding the DB server's wall
 * clock (SYSTIMESTAMP), so the comparison is only right when the app server and
 * the DB server share a time zone (docs/gate-design.md §7.3).
 */
export function toLocalWallClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid commit time: ${iso}`);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
