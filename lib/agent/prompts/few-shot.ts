import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state";

type FewShotPair = [HumanMessage, AIMessage];

const RETRIEVAL_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("Show me all customers from Mumbai"),
    new AIMessage(
      '```sql\nSELECT * FROM "customers" WHERE "city" = \'Mumbai\';\n```\nRetrieves all customers whose city is Mumbai.',
    ),
  ],
  [
    new HumanMessage("List the top 5 products by revenue"),
    new AIMessage(
      '```sql\nSELECT p."id", p."name", SUM(si."unit_price" * si."quantity") AS revenue\nFROM "sales_items" si\nJOIN "products" p ON si."product_id" = p."id"\nGROUP BY p."id", p."name"\nORDER BY revenue DESC\nLIMIT 5;\n```\nJoins sales items and products, sums up revenue, returns the top 5.',
    ),
  ],
];

const BOOLEAN_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("Does customer ID 42 exist?"),
    new AIMessage(
      '```sql\nSELECT EXISTS(SELECT 1 FROM "customers" WHERE "id" = 42) AS "exists";\n```\nReturns true if a customer with ID 42 exists.',
    ),
  ],
  [
    new HumanMessage("Are there any pending sales?"),
    new AIMessage(
      '```sql\nSELECT EXISTS(SELECT 1 FROM "sales" WHERE "status" = \'Pending\') AS "hasPendingSales";\n```\nReturns true/false whether pending sales exist.',
    ),
  ],
];

const ANALYTICS_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("What is the average sale value per city this month?"),
    new AIMessage(
      '```sql\nSELECT c."city", ROUND(AVG(s."amount"), 2) AS "avgSaleValue"\nFROM "sales" s\nJOIN "customers" c ON s."customer_id" = c."id"\nWHERE strftime(\'%Y-%m\', s."sale_date") = strftime(\'%Y-%m\', \'now\')\nGROUP BY c."city"\nORDER BY "avgSaleValue" DESC;\n```\nAggregates sales by city for the current month.',
    ),
  ],
];

const MODIFICATION_SHOTS: FewShotPair[] = [
  [
    new HumanMessage(
      "Insert a new employee with first name John and email john@test.com",
    ),
    new AIMessage(
      '```sql\nINSERT INTO "employees" ("first_name", "last_name", "email", "role", "salary", "hire_date") VALUES (\'John\', \'Doe\', \'john@test.com\', \'Developer\', 80000.00, \'2026-06-29\');\n```\nInserts a new employee record with specified fields.',
    ),
  ],
];

const SCHEMA_SHOTS: FewShotPair[] = [
  [
    new HumanMessage(
      "Create an index on the email column of the employees table",
    ),
    new AIMessage(
      '```sql\nCREATE INDEX idx_employees_email ON "employees" ("email");\n```\nCreates a B-tree index on the email column of employees.',
    ),
  ],
];

const GROUNDING_SHOTS: FewShotPair[] = [
  [
    new HumanMessage("Show all support tickets"),
    new AIMessage(
      'There is no "tickets" or "support_tickets" table in the database. The available tables are "employees", "departments", "projects", "employee_projects", "customers", "products", "sales", "sales_items", and "performance_reviews". Please ask a question related to these tables.',
    ),
  ],
  [
    new HumanMessage("fetch top 5 posts"),
    new AIMessage(
      'The "posts" table does not exist in the database. The available tables are "employees", "departments", "projects", "employee_projects", "customers", "products", "sales", "sales_items", and "performance_reviews".',
    ),
  ],
];

export function getFewShotExamples(
  intent: AgentStateType["intent"],
  _dialect: AgentStateType["dbDialect"],
): (HumanMessage | AIMessage)[] {
  const map: Partial<Record<AgentStateType["intent"], FewShotPair[]>> = {
    sql_retrieval: [...RETRIEVAL_SHOTS, ...GROUNDING_SHOTS],
    sql_analytics: [...ANALYTICS_SHOTS, ...GROUNDING_SHOTS],
    boolean_check: [...BOOLEAN_SHOTS, ...GROUNDING_SHOTS],
    sql_modification: [...MODIFICATION_SHOTS, ...GROUNDING_SHOTS],
    sql_schema: SCHEMA_SHOTS,
  };
  return (map[intent] ?? []).flat();
}
