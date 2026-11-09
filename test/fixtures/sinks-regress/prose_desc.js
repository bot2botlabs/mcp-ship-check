// A tool description mentioning SQL keywords in prose must not be flagged.
export const DESCRIPTION =
  'Run a read-only query. Allowed: SELECT, WITH, VALUES. ' +
  'Reads rows FROM your database and will UPDATE nothing. ';
