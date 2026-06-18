import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../state';

type FewShotPair = [HumanMessage, AIMessage];

const RETRIEVAL_SHOTS: FewShotPair[] = [
  [
    new HumanMessage('Show me all customers from Mumbai'),
    new AIMessage(
      '```sql\nSELECT * FROM "customers" WHERE "city" = \'Mumbai\';\n```\nRetrieves all customers whose city is Mumbai.'
    ),
  ],
  [
    new HumanMessage('List the top 5 products by revenue'),
    new AIMessage(
      '```sql\nSELECT "productId", "name", SUM("price" * "quantity") AS revenue\nFROM "order_items"\nGROUP BY "productId", "name"\nORDER BY revenue DESC\nLIMIT 5;\n```\nJoins order items, sums up revenue per product, returns the top 5.'
    ),
  ],
];

const BOOLEAN_SHOTS: FewShotPair[] = [
  [
    new HumanMessage('Does customer ID 42 exist?'),
    new AIMessage(
      '```sql\nSELECT EXISTS(SELECT 1 FROM "customers" WHERE "id" = 42) AS "exists";\n```\nReturns true if a customer with ID 42 exists.'
    ),
  ],
  [
    new HumanMessage('Are there any pending orders?'),
    new AIMessage(
      '```sql\nSELECT EXISTS(SELECT 1 FROM "orders" WHERE "status" = \'pending\') AS "hasPendingOrders";\n```\nReturns true/false whether pending orders exist.'
    ),
  ],
];

const ANALYTICS_SHOTS: FewShotPair[] = [
  [
    new HumanMessage('What is the average order value per city this month?'),
    new AIMessage(
      '```sql\nSELECT c."city", ROUND(AVG(o."totalAmount"), 2) AS "avgOrderValue"\nFROM "orders" o\nJOIN "customers" c ON o."customerId" = c."id"\nWHERE DATE_TRUNC(\'month\', o."createdAt") = DATE_TRUNC(\'month\', CURRENT_DATE)\nGROUP BY c."city"\nORDER BY "avgOrderValue" DESC;\n```\nAggregates orders by city for the current month.'
    ),
  ],
];

const MODIFICATION_SHOTS: FewShotPair[] = [
  [
    new HumanMessage('Insert a new user with name John and email john@test.com'),
    new AIMessage(
      '```sql\nINSERT INTO "users" ("name", "email") VALUES (\'John\', \'john@test.com\');\n```\nInserts a new user record with the specified name and email.'
    ),
  ],
];

const SCHEMA_SHOTS: FewShotPair[] = [
  [
    new HumanMessage('Create an index on the email column of the users table'),
    new AIMessage(
      '```sql\nCREATE INDEX idx_users_email ON "users" ("email");\n```\nCreates a B-tree index on the email column for faster lookups.'
    ),
  ],
];

const GROUNDING_SHOTS: FewShotPair[] = [
  [
    new HumanMessage('Show all employees ordered by salary'),
    new AIMessage(
      'There is no "employees" or "employee" table in the database. The available tables are "users", "products", and "orders". Please ask a question related to these tables.'
    ),
  ],
  [
    new HumanMessage('fetch top 5 posts'),
    new AIMessage(
      'The "posts" table does not exist in the database. The available tables are "orders", "products", and "users".'
    ),
  ],
];

export function getFewShotExamples(
  intent: AgentStateType['intent'],
  _dialect: AgentStateType['dbDialect']
): (HumanMessage | AIMessage)[] {
  const map: Partial<Record<AgentStateType['intent'], FewShotPair[]>> = {
    sql_retrieval: [...RETRIEVAL_SHOTS, ...GROUNDING_SHOTS],
    sql_analytics: [...ANALYTICS_SHOTS, ...GROUNDING_SHOTS],
    boolean_check: [...BOOLEAN_SHOTS, ...GROUNDING_SHOTS],
    sql_modification: [...MODIFICATION_SHOTS, ...GROUNDING_SHOTS],
    sql_schema: SCHEMA_SHOTS,
  };
  return (map[intent] ?? []).flat();
}
