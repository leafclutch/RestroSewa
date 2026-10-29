// Shared by the dashboard (which remembers the on-screen section for a reload and hides its
// sections while it lands on one) and the top bar's Home (which clears both). Kept in its
// own tiny module so the nav, loaded on every staff page, doesn't pull in the dashboard.

/** sessionStorage key: the section on screen when the dashboard was last left/reloaded. */
export const DASH_SECTION_KEY = "rs-dashboard-section";

/** The <html> attribute that hides the dashboard's sections while it is being positioned. */
export const DASH_RESTORING_ATTR = "data-dash-restoring";
