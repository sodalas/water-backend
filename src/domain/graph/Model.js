// domain/graph/Model.js

/**
 * Canary Graph Model Definitions.
 * Defines the schema concepts for the Persistence Layer.
 * STRICT: Response Linkage Semantics.
 */

export const NODES = {
  IDENTITY: 'Identity',
  ASSERTION: 'Assertion',
  // Topics: Representation deferred (Node vs Prop allowed conceptually)
  TOPIC: 'Topic',
  RESOURCE: 'Resource'
};

export const EDGES = {
  // Provenance (Immutable)
  AUTHORED_BY: 'AUTHORED_BY', // Assertion -> Identity

  // Structural (Strict Tree)
  // Constraint: A 'response' Assertion MUST have exactly ONE outgoing RESPONDS_TO edge.
  // Constraint: Creates a DAG/Tree. No Cycles.
  RESPONDS_TO: 'RESPONDS_TO', // Assertion -> Assertion (Parent)

  // Curatorial
  CURATES: 'CURATES',         // Assertion -> Assertion | Resource
  
  // Semantic Connectivity
  MENTIONS: 'MENTIONS',       // Assertion -> Identity
  TAGGED_WITH: 'TAGGED_WITH'  // Assertion -> Topic
};

/**
 * Immutable Property Allow-List for Assertion Nodes.
 */
export const ASSERTION_PROPERTIES = [
  'id',             // Graph ID (Opaque)
  'assertionType',  // Enum from CSO
  'text',           // Content
  'createdAt',      // Timestamp
  'visibility',     // Access Control
  'media'           // Serialized Media definitions
];

/**
 * Identity Property Allow-List.
 */
export const IDENTITY_PROPERTIES = [
  'id',
  'handle',
  'displayName'
];

/**
 * Structural Invariants (Documentation Only - Enforced by Adapter)
 */
export const INVARIANTS = {
  isTree: true, // Responses form a tree
  isAppendOnly: true // Content updates yield new nodes
};
