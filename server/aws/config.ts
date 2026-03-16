export function getActiveDatabase(): string {
  return process.env.NODE_ENV === "production" ? "bitech_prod_db" : "bitech_staging_db";
}
