# PrepSQL - AI-Powered SQL Query Generator

PrepSQL is a modern web application that uses Claude AI to generate SQL queries from natural language prompts. Connect to your database, describe what you want in plain English, and let AI generate the SQL for you.

## Features

- **AI-Powered SQL Generation**: Describe your query in natural language, Claude AI generates SQL automatically
- **Multi-Database Support**: Connect to PostgreSQL, MySQL, MariaDB, and SQLite databases
- **Query Execution**: Run generated SQL directly and view results in a clean table format
- **Query History**: Track and re-execute previous queries with full history sidebar
- **Safety Features**: Built-in safety warnings for destructive operations (DROP, TRUNCATE, DELETE without WHERE)
- **Export Results**: Download query results as CSV for further analysis
- **Session-Based**: Secure, session-based database credential storage (no persistent auth needed)
- **Modern UI**: Dark theme with responsive design using Tailwind CSS and shadcn/ui

## Getting Started

### Prerequisites

- Node.js 18+
- An Anthropic API key (for Claude AI)
- Access to a database (PostgreSQL, MySQL, MariaDB, or SQLite)

### Installation

1. Clone or download the project
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables in `.env.local`:
   ```
   ANTHROPIC_API_KEY=your-anthropic-api-key-here
   ```

4. Start the development server:
   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

### Connecting to a Database

1. Select your database type (PostgreSQL, MySQL, MariaDB, or SQLite)
2. Enter connection details:
   - **SQLite**: File path to the database file
   - **PostgreSQL/MySQL/MariaDB**: Host, Port, User, Password, Database name
3. Give your connection a name for easy reference
4. Click "Connect Database"

### Generating and Executing Queries

1. Once connected, enter a natural language prompt in the editor
2. Click "Generate SQL" - Claude AI will create the SQL query
3. Review the generated SQL and explanation
4. Click "Execute Query" to run it against your database
5. View results in the results table below
6. Use "Export CSV" to download the results

### Query History

- All queries are saved in the history sidebar on the right
- Click any previous query to re-execute it
- Failed queries are highlighted in red with error messages
- Clear entire history with "Clear History" button

## Architecture

### Frontend Components

- **ConnectionForm**: Database connection setup interface
- **SQLEditor**: Natural language input and SQL preview
- **ResultsTable**: Query results with pagination and CSV export
- **HistorySidebar**: Query history browser and management

### API Routes

- `POST /api/connection` - Set/get database connection
- `DELETE /api/connection` - Clear connection
- `POST /api/generate` - Generate SQL from prompt using Claude
- `POST /api/execute` - Execute SQL query against connected database
- `GET /api/history` - Retrieve query history
- `DELETE /api/history` - Clear query history

### Backend Modules

- **lib/app-state.ts** - Session management and credential storage (MongoDB-backed)
- **lib/db.ts** - MongoDB data access layer (query history, analysis, chat, connections, API keys, settings)
- **lib/mongodb.ts** - MongoDB connection singleton
- **lib/database.ts** - Database connection handling for multiple databases
- **lib/claude.ts** - Anthropic Claude API integration

## Supported Databases

- **PostgreSQL** - Full support with advanced features
- **MySQL 8.0+** - Window functions, JSON, CTEs
- **MariaDB** - MySQL compatible with additional features
- **SQLite** - For development and testing (requires native binding)

## Security

- Database credentials are stored in encrypted server-side sessions
- API keys and sensitive data never exposed to client
- Input validation on all database operations
- Safety warnings for destructive SQL operations
- No persistent user authentication required

## Troubleshooting

### "Failed to connect to database. Check your credentials."
This error means PrepSQL couldn't establish a connection. **Most commonly**, your database server isn't running:

1. **PostgreSQL**:
   - macOS: `brew services start postgresql` or `postgres -D /usr/local/var/postgres`
   - Linux: `sudo systemctl start postgresql`
   - Windows: Check Services app or use PostgreSQL installer
   - Verify: `psql -h localhost -U postgres -d sequelize_db` should work

2. **MySQL/MariaDB**:
   - macOS: `brew services start mysql` or `mysql.server start`
   - Linux: `sudo systemctl start mysql` or `sudo systemctl start mariadb`
   - Windows: Check Services app
   - Verify: `mysql -h localhost -u root -p` should work

3. **Verify Credentials**:
   - Make sure the username and password are correct
   - Ensure the database exists
   - Check that the user has permission to access that database
   - For PostgreSQL without a password, leave password blank or use `trust` in pg_hba.conf

### Wrong Credentials Error
If you see detailed error messages about authentication:
- **PostgreSQL**: Check if you need a password. Try leaving it blank, or use `psql` CLI to test first
- **MySQL**: Verify the user exists: `SELECT user FROM mysql.user;`
- **Port mismatch**: PostgreSQL defaults to 5432, MySQL to 3306

### SQLite Connection Error
SQLite requires native compilation which may not be available in all environments. Use PostgreSQL or MySQL for production deployments.

### API Key Missing
Ensure `ANTHROPIC_API_KEY` is set in `.env.local`. Get a key from https://console.anthropic.com/

### "Connection refused" or Timeout
The database server is not running or not accessible:
- Check if the server is running (see database startup commands above)
- Verify the hostname/IP is correct (localhost vs 127.0.0.1 vs IP address)
- Check firewall settings if connecting to a remote database
- Ensure the port matches your database configuration

## Technology Stack

- **Frontend**: React 19, Next.js 16 App Router, Tailwind CSS
- **UI Components**: shadcn/ui
- **Database Drivers**: PostgreSQL (pg), MySQL (mysql2), SQLite (sqlite3)
- **AI**: Anthropic Claude API
- **Styling**: Tailwind CSS with custom dark theme

## Environment Variables

```
# Required
ANTHROPIC_API_KEY=your-api-key-here

# Optional (auto-generated if not set)
ENCRYPTION_KEY=
```

## Development

### Running the Dev Server
```bash
pnpm dev
```

### Building for Production
```bash
pnpm build
pnpm start
```

### Type Checking
```bash
pnpm type-check
```

## Notes

- Query execution timeout: 30 seconds
- Result set limit: 1000 rows (adjustable in code)
- Session data persists during your browser session
- Database credentials are not saved permanently

## License

MIT

## Support

For issues or feature requests, please refer to the documentation or check the console logs for detailed error messages.
