import os
import json
import secrets
import threading
from typing import Dict, List, Optional, Tuple, Any
from config import SESSIONS_FILE, GROQ_MODEL, ANTHROPIC_MODEL

# Thread safety lock for sessions file access
sessions_lock = threading.Lock()

def mask_api_key(key: str) -> str:
    if len(key) <= 12:
        return '••••••••'
    return f"{key[:10]}...{key[-4:]}"

class SessionManager:
    @staticmethod
    def load_sessions() -> Dict[str, Any]:
        with sessions_lock:
            try:
                if not os.path.exists(SESSIONS_FILE):
                    os.makedirs(os.path.dirname(SESSIONS_FILE), exist_ok=True)
                    with open(SESSIONS_FILE, 'w') as f:
                        json.dump({}, f)
                    return {}
                with open(SESSIONS_FILE, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"[session] Failed to load persisted sessions: {e}")
                return {}

    @staticmethod
    def save_sessions(data: Dict[str, Any]) -> None:
        with sessions_lock:
            try:
                os.makedirs(os.path.dirname(SESSIONS_FILE), exist_ok=True)
                with open(SESSIONS_FILE, 'w') as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                print(f"[session] Failed to persist sessions: {e}")

    @classmethod
    def get_session(cls, session_id: str) -> Dict[str, Any]:
        sessions = cls.load_sessions()
        if session_id not in sessions:
            sessions[session_id] = {
                "connections": [],
                "queryMode": "crud",
                "history": []
            }
            cls.save_sessions(sessions)
        return sessions[session_id]

    @classmethod
    def update_session(cls, session_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        sessions = cls.load_sessions()
        if session_id not in sessions:
            sessions[session_id] = {
                "connections": [],
                "queryMode": "crud",
                "history": []
            }
        sessions[session_id].update(updates)
        cls.save_sessions(sessions)
        return sessions[session_id]

    @classmethod
    def get_connections(cls, session_id: str) -> List[Dict[str, Any]]:
        session = cls.get_session(session_id)
        return session.get("connections", [])

    @classmethod
    def get_connection(cls, session_id: str) -> Optional[Dict[str, Any]]:
        session = cls.get_session(session_id)
        active_id = session.get("activeConnectionId")
        if not active_id:
            return None
        for conn in session.get("connections", []):
            if conn.get("id") == active_id:
                return conn
        return None

    @classmethod
    def add_connection(cls, session_id: str, connection: Dict[str, Any]) -> Dict[str, Any]:
        sessions = cls.load_sessions()
        if session_id not in sessions:
            sessions[session_id] = {
                "connections": [],
                "queryMode": "crud",
                "history": []
            }
        session = sessions[session_id]
        conns = session.get("connections", [])

        # Match duplicates by credentials
        existing = None
        for c in conns:
            if c.get("type") != connection.get("type"):
                continue
            if c.get("type") == "sqlite":
                if c.get("filepath") == connection.get("filepath"):
                    existing = c
                    break
            else:
                if (c.get("host") == connection.get("host") and
                    c.get("port") == connection.get("port") and
                    c.get("database") == connection.get("database") and
                    c.get("user") == connection.get("user")):
                    existing = c
                    break

        if existing:
            if "password" in connection:
                existing["password"] = connection["password"]
            if connection.get("name") and connection.get("name") != existing.get("name"):
                existing["name"] = connection["name"]
            session["activeConnectionId"] = existing["id"]
            cls.save_sessions(sessions)
            return existing

        # Create a new connection
        new_id = secrets.token_hex(8)
        new_conn = {**connection, "id": new_id}
        conns.append(new_conn)
        session["connections"] = conns
        session["activeConnectionId"] = new_id
        cls.save_sessions(sessions)
        return new_conn

    @classmethod
    def remove_connection(cls, session_id: str, conn_id: str) -> None:
        sessions = cls.load_sessions()
        if session_id not in sessions:
            return
        session = sessions[session_id]
        session["connections"] = [c for c in session.get("connections", []) if c.get("id") != conn_id]
        if session.get("activeConnectionId") == conn_id:
            session["activeConnectionId"] = None
        cls.save_sessions(sessions)

    @classmethod
    def set_active_connection(cls, session_id: str, conn_id: str) -> None:
        sessions = cls.load_sessions()
        if session_id not in sessions:
            return
        session = sessions[session_id]
        # Verify the connection exists in the session
        exists = any(c.get("id") == conn_id for c in session.get("connections", []))
        if exists:
            session["activeConnectionId"] = conn_id
            cls.save_sessions(sessions)

    @classmethod
    def get_query_mode(cls, session_id: str) -> str:
        session = cls.get_session(session_id)
        return session.get("queryMode", "crud")

    @classmethod
    def set_query_mode(cls, session_id: str, mode: str) -> None:
        cls.update_session(session_id, {"queryMode": mode})

    @classmethod
    def add_to_history(cls, session_id: str, item: Dict[str, Any]) -> None:
        sessions = cls.load_sessions()
        if session_id not in sessions:
            sessions[session_id] = {
                "connections": [],
                "queryMode": "crud",
                "history": []
            }
        session = sessions[session_id]
        history = session.get("history", [])
        # Insert at the beginning of the list
        history.insert(0, item)
        if len(history) > 50:
            history = history[:50]
        session["history"] = history
        cls.save_sessions(sessions)

    @classmethod
    def get_history(cls, session_id: str) -> List[Dict[str, Any]]:
        session = cls.get_session(session_id)
        return session.get("history", [])

    @classmethod
    def clear_history(cls, session_id: str) -> None:
        cls.update_session(session_id, {"history": []})

    @classmethod
    def get_anthropic_api_key(cls, session_id: str) -> Optional[str]:
        session = cls.get_session(session_id)
        key = session.get("anthropicApiKey")
        if key and key.strip():
            return key.strip()
        env_key = os.getenv("ANTHROPIC_API_KEY")
        if env_key and env_key.strip():
            return env_key.strip()
        return None

    @classmethod
    def get_groq_api_key(cls, session_id: str) -> Optional[str]:
        session = cls.get_session(session_id)
        key = session.get("groqApiKey")
        if key and key.strip():
            return key.strip()
        env_key = os.getenv("GROQ_API_KEY")
        if env_key and env_key.strip():
            return env_key.strip()
        return None

    @classmethod
    def get_openrouter_api_key(cls, session_id: str) -> Optional[str]:
        session = cls.get_session(session_id)
        key = session.get("openrouterApiKey")
        if key and key.strip():
            return key.strip()
        env_key = os.getenv("OPENROUTER_API_KEY")
        if env_key and env_key.strip():
            return env_key.strip()
        return None

    @classmethod
    def get_ai_api_key(cls, session_id: str) -> Optional[Tuple[str, str]]:
        # Returns (provider, key)
        # OpenRouter is the default provider: check it first!
        openrouter_key = cls.get_openrouter_api_key(session_id)
        if openrouter_key:
            return "openrouter", openrouter_key
        groq_key = cls.get_groq_api_key(session_id)
        if groq_key:
            return "groq", groq_key
        anthropic_key = cls.get_anthropic_api_key(session_id)
        if anthropic_key:
            return "anthropic", anthropic_key
        return None

    @classmethod
    def get_ai_key_info(cls, session_id: str) -> Dict[str, Any]:
        session = cls.get_session(session_id)
        
        # Check session keys first (OpenRouter -> Groq -> Anthropic)
        openrouter_key = session.get("openrouterApiKey")
        if openrouter_key and openrouter_key.strip():
            return {
                "configured": True,
                "provider": "openrouter",
                "source": "session",
                "maskedKey": mask_api_key(openrouter_key)
            }
        
        groq_key = session.get("groqApiKey")
        if groq_key and groq_key.strip():
            return {
                "configured": True,
                "provider": "groq",
                "source": "session",
                "maskedKey": mask_api_key(groq_key)
            }
        
        anthropic_key = session.get("anthropicApiKey")
        if anthropic_key and anthropic_key.strip():
            return {
                "configured": True,
                "provider": "anthropic",
                "source": "session",
                "maskedKey": mask_api_key(anthropic_key)
            }

        # Check env keys next
        env_openrouter = os.getenv("OPENROUTER_API_KEY")
        if env_openrouter and env_openrouter.strip():
            return {
                "configured": True,
                "provider": "openrouter",
                "source": "env",
                "maskedKey": mask_api_key(env_openrouter)
            }

        env_groq = os.getenv("GROQ_API_KEY")
        if env_groq and env_groq.strip():
            return {
                "configured": True,
                "provider": "groq",
                "source": "env",
                "maskedKey": mask_api_key(env_groq)
            }

        env_anthropic = os.getenv("ANTHROPIC_API_KEY")
        if env_anthropic and env_anthropic.strip():
            return {
                "configured": True,
                "provider": "anthropic",
                "source": "env",
                "maskedKey": mask_api_key(env_anthropic)
            }

        return {"configured": False, "source": "none"}

    @classmethod
    def set_ai_api_key(cls, session_id: str, api_key: str) -> None:
        trimmed = api_key.strip()
        sessions = cls.load_sessions()
        if session_id not in sessions:
            sessions[session_id] = {
                "connections": [],
                "queryMode": "crud",
                "history": []
            }
        session = sessions[session_id]
        if trimmed.startswith("sk-or-"):
            session["openrouterApiKey"] = trimmed
            for key in ["groqApiKey", "anthropicApiKey"]:
                if key in session:
                    del session[key]
        elif trimmed.startswith("gsk_"):
            session["groqApiKey"] = trimmed
            for key in ["openrouterApiKey", "anthropicApiKey"]:
                if key in session:
                    del session[key]
        elif trimmed.startswith("sk-ant-"):
            session["anthropicApiKey"] = trimmed
            for key in ["openrouterApiKey", "groqApiKey"]:
                if key in session:
                    del session[key]
        else:
            # Fallback to openrouter if it's a general key
            session["openrouterApiKey"] = trimmed
            for key in ["groqApiKey", "anthropicApiKey"]:
                if key in session:
                    del session[key]
        cls.save_sessions(sessions)

    @classmethod
    def clear_ai_api_key(cls, session_id: str) -> None:
        sessions = cls.load_sessions()
        if session_id in sessions:
            session = sessions[session_id]
            for key in ["groqApiKey", "anthropicApiKey", "openrouterApiKey"]:
                if key in session:
                    del session[key]
            cls.save_sessions(sessions)

def strip_password(connection: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in connection.items() if k != "password"}

def validate_connection(connection: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    conn_type = connection.get("type")
    if not conn_type:
        return False, "Database type is required"
    if conn_type == "sqlite":
        if not connection.get("filepath"):
            return False, "Filepath is required for SQLite"
    else:
        if not connection.get("host"):
            return False, "Host is required"
        if not connection.get("user"):
            return False, "User is required"
        if not connection.get("database"):
            return False, "Database name is required"
    return True, None
