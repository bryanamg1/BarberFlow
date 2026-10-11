const searchColumns = ['first_name', 'last_name', 'phone', 'email', 'instagram'] as const;

export function clientSearchFilter(term: string): string {
  // PostgREST imatch maps to ~*. PostgreSQL's ***= director makes every subsequent
  // character literal, including LIKE wildcards, regex syntax and embedded options.
  // Unlike ilike, imatch does not translate user-written '*' into '%'.
  const pattern = `***=${term}`;
  // Escape the PostgREST quoted-value grammar, then let the SDK encode the URL once.
  const quoted = `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return searchColumns.map((column) => `${column}.imatch.${quoted}`).join(',');
}
