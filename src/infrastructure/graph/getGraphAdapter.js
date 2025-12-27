// src/infrastructure/graph/getGraphAdapter.js
import { Neo4jGraphAdapter } from "./Neo4jGraphAdapter.js";

let singleton = null;

export function getGraphAdapter() {
  if (singleton) return singleton;

  singleton = new Neo4jGraphAdapter({
    uri: process.env.NEO4J_URI,
    user: process.env.NEO4J_USER,
    password: process.env.NEO4J_PASSWORD,
  });

  return singleton;
}
