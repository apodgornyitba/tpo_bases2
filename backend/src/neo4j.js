import neo4j from 'neo4j-driver';

const uri  = process.env.NEO4J_URI
const user = process.env.NEO4J_USER
const pass = process.env.NEO4J_PASSWORD

export const driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
export const session = () => driver.session({
  defaultAccessMode: neo4j.session.READ,
  database: process.env.NEO4J_DATABASE || 'neo4j',
});
export const toInt   = neo4j.int;

export async function pingNeo4j() {
  await driver.verifyConnectivity();
  return true;
}