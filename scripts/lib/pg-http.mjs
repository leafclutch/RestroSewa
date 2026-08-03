/**
 * A `pg.Client`-shaped client that talks SQL over HTTP, via the `postgres-meta`
 * service that self-hosted Supabase publishes through Kong at `/pg/query`.
 *
 * WHY THIS EXISTS: the self-hosted stack runs under Coolify, and its Postgres is
 * on a Docker-internal network — the host `supabase-db-<id>` does not resolve off
 * the droplet, and 5432 is not published. The usual answers are an SSH tunnel or
 * exposing the port publicly; this is neither. Kong is already reachable over
 * TLS, already authenticates with the service-role key, and `postgres-meta`
 * connects as `supabase_admin` (a superuser), so it can do everything the
 * migration and the data copy need without opening the database to the internet
 * or moving a private key onto anyone's laptop.
 *
 * THE ONE REAL CONSTRAINT: `/pg/query` takes a SQL STRING and nothing else — it
 * has no bind parameters. Every value therefore has to be rendered into the
 * statement text, which is precisely where data migrations corrupt themselves.
 * Two defences, and the callers depend on both:
 *
 *   1. `escapeLiteral()` below is libpq's algorithm, not an ad-hoc quote-doubler:
 *      a string containing a backslash is emitted as `E'…'` with backslashes
 *      doubled, so the result is correct whether or not `standard_conforming_strings`
 *      is on. This is used for the handful of scalar parameters in this codebase.
 *
 *   2. BULK ROW DATA DOES NOT GO THROUGH ESCAPING AT ALL. It is serialised with
 *      `JSON.stringify`, wrapped in a dollar-quoted string, and handed to
 *      `jsonb_populate_recordset` so that POSTGRES does the parsing and the type
 *      coercion. Verified end-to-end against single quotes, double quotes,
 *      backslashes, newlines, tabs, emoji and Devanagari — all byte-identical on
 *      the way back. See `dollarQuote()` for the one assumption that makes it safe.
 *
 * Only the surface `migrate.mjs` / `clone-db.mjs` / `copy-storage.mjs` actually
 * use is implemented: connect / query / end, and `rows` on the result.
 */

/** libpq's PQescapeLiteral, for the scalar parameters that are not bulk data. */
export function escapeLiteral(str) {
  let hasBackslash = false;
  let out = "'";
  for (const ch of str) {
    if (ch === "'") out += "''";
    else if (ch === "\\") { out += "\\\\"; hasBackslash = true; }
    else out += ch;
  }
  out += "'";
  // E'' makes the backslash escapes explicit rather than relying on the server's
  // standard_conforming_strings setting being what we assume.
  return hasBackslash ? ` E${out}` : out;
}

/**
 * Wrap `str` in a dollar-quoted literal, choosing a tag the payload does not
 * contain. Dollar quoting has NO escape sequences at all — the literal ends at
 * the closing tag and nowhere else — so the only way to break out is to contain
 * the tag itself, which is checked here rather than assumed.
 */
export function dollarQuote(str) {
  let tag = "$cp$";
  for (let i = 0; str.includes(tag); i++) tag = `$cp${i}$`;
  return `${tag}${str}${tag}`;
}

/** Render a JS value as a SQL literal. */
export function toLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`cannot render ${v} as a SQL literal`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `${escapeLiteral(v.toISOString())}::timestamptz`;
  if (Array.isArray(v)) {
    // Only text[] is ever passed this way (migrate.mjs's ledger `statements`).
    return v.length ? `ARRAY[${v.map(toLiteral).join(", ")}]::text[]` : `'{}'::text[]`;
  }
  if (typeof v === "object") return `${escapeLiteral(JSON.stringify(v))}::jsonb`;
  return escapeLiteral(String(v));
}

export class HttpClient {
  constructor({ url, key, label = "http" }) {
    if (!url || !key) throw new Error("HttpClient needs { url, key }");
    this.endpoint = `${url.replace(/\/$/, "")}/pg/query`;
    this.key = key;
    this.label = label;
  }

  async connect() {
    // Fail here, loudly, rather than on whichever statement happens to be first.
    const { rows } = await this.query("select current_user, version()");
    if (!rows.length) throw new Error(`${this.endpoint} did not answer a trivial query`);
  }

  /**
   * `params` are substituted into the statement text in ONE pass, so a value
   * that happens to contain `$2` is never rescanned as a placeholder.
   */
  async query(sql, params) {
    const text = params?.length
      ? sql.replace(/\$(\d+)/g, (m, n) => {
          const i = Number(n) - 1;
          if (i >= params.length) return m; // not ours — leave it alone
          return toLiteral(params[i]);
        })
      : sql;

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: text }),
    });

    const body = await res.text();
    let json;
    try { json = JSON.parse(body); }
    catch { throw new Error(`${res.status} from ${this.endpoint}: ${body.slice(0, 300)}`); }

    // postgres-meta reports SQL errors in a 200 body as often as a 4xx, so the
    // status code alone is not the test.
    if (json?.error) {
      const e = new Error(String(json.error).replace(/\s+/g, " ").trim());
      e.code = json.code;
      throw e;
    }
    if (!res.ok) throw new Error(`${res.status} from ${this.endpoint}: ${body.slice(0, 300)}`);

    // A multi-statement request returns only the LAST statement's rows, which is
    // exactly how the callers use it.
    const rows = Array.isArray(json) ? json : [];
    return { rows, rowCount: rows.length };
  }

  async end() { /* stateless — nothing to close */ }
}
