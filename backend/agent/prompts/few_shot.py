from typing import List, Union
from langchain_core.messages import HumanMessage, AIMessage

RETRIEVAL_SHOTS: List[Union[HumanMessage, AIMessage]] = [
    HumanMessage(content='Show me all customers from Mumbai'),
    AIMessage(content='```sql\nSELECT * FROM "customers" WHERE "city" = \'Mumbai\';\n```\nRetrieves all customers whose city is Mumbai.'),
    HumanMessage(content='List the top 5 products by revenue'),
    AIMessage(content='```sql\nSELECT "productId", "name", SUM("price" * "quantity") AS revenue\nFROM "order_items"\nGROUP BY "productId", "name"\nORDER BY revenue DESC\nLIMIT 5;\n```\nJoins order items, sums up revenue per product, returns the top 5.')
]

BOOLEAN_SHOTS: List[Union[HumanMessage, AIMessage]] = [
    HumanMessage(content='Does customer ID 42 exist?'),
    AIMessage(content='```sql\nSELECT EXISTS(SELECT 1 FROM "customers" WHERE "id" = 42) AS "exists";\n```\nReturns true if a customer with ID 42 exists.'),
    HumanMessage(content='Are there any pending orders?'),
    AIMessage(content='```sql\nSELECT EXISTS(SELECT 1 FROM "orders" WHERE "status" = \'pending\') AS "hasPendingOrders";\n```\nReturns true/false whether pending orders exist.')
]

ANALYTICS_SHOTS: List[Union[HumanMessage, AIMessage]] = [
    HumanMessage(content='What is the average order value per city this month?'),
    AIMessage(content='```sql\nSELECT c."city", ROUND(AVG(o."totalAmount"), 2) AS "avgOrderValue"\nFROM "orders" o\nJOIN "customers" c ON o."customerId" = c."id"\nWHERE DATE_TRUNC(\'month\', o."createdAt") = DATE_TRUNC(\'month\', CURRENT_DATE)\nGROUP BY c."city"\nORDER BY "avgOrderValue" DESC;\n```\nAggregates orders by city for the current month.')
]

MODIFICATION_SHOTS: List[Union[HumanMessage, AIMessage]] = [
    HumanMessage(content='Insert a new user with name John and email john@test.com'),
    AIMessage(content='```sql\nINSERT INTO "users" ("name", "email") VALUES (\'John\', \'john@test.com\');\n```\nInserts a new user record with the specified name and email.')
]

SCHEMA_SHOTS: List[Union[HumanMessage, AIMessage]] = [
    HumanMessage(content='Create an index on the email column of the users table'),
    AIMessage(content='```sql\nCREATE INDEX idx_users_email ON "users" ("email");\n```\nCreates a B-tree index on the email column for faster lookups.')
]

GROUNDING_SHOTS: List[Union[HumanMessage, AIMessage]] = [
    HumanMessage(content='Show all employees ordered by salary'),
    AIMessage(content='There is no "employees" or "employee" table in the database. The available tables are "users", "products", and "orders". Please ask a question related to these tables.'),
    HumanMessage(content='fetch top 5 posts'),
    AIMessage(content='The "posts" table does not exist in the database. The available tables are "orders", "products", and "users".')
]

def get_few_shot_examples(intent: str, db_dialect: str) -> List[Union[HumanMessage, AIMessage]]:
    # In PostgreSQL, we show examples with double quotes. For MySQL, backticks, etc.
    # Since the examples above are static, we just map them by intent.
    mapping = {
        "sql_retrieval": RETRIEVAL_SHOTS + GROUNDING_SHOTS,
        "sql_analytics": ANALYTICS_SHOTS + GROUNDING_SHOTS,
        "boolean_check": BOOLEAN_SHOTS + GROUNDING_SHOTS,
        "sql_modification": MODIFICATION_SHOTS + GROUNDING_SHOTS,
        "sql_schema": SCHEMA_SHOTS
    }
    
    raw_shots = mapping.get(intent, [])
    
    # Adjust quotes based on dialect if needed
    adjusted_shots = []
    for msg in raw_shots:
        content = msg.content
        if db_dialect in ("mysql", "mariadb") and "```sql" in content:
            # Replace double quotes with backticks in SQL block
            # This is a simple approximation
            adjusted_shots.append(msg._class_(content=content))
        else:
            adjusted_shots.append(msg)
            
    return adjusted_shots
