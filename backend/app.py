from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional
import json
import asyncio
from datetime import datetime
import base64
import uvicorn
import asyncpg
from passlib.context import CryptContext

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection pool
db_pool = None

# Active WebSocket connections
active_connections: Dict[str, WebSocket] = {}

# Database configuration
DATABASE_URL="postgresql://myuser:mypassword@localhost:5433/mydb"

class UserSignup(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Message(BaseModel):
    from_user: str
    to_user: str
    content: str
    file_data: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None

@app.on_event("startup")
async def startup():
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)
    
    # Create tables if they don't exist
    async with db_pool.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                from_user VARCHAR(50) NOT NULL,
                to_user VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                file_data TEXT,
                file_name VARCHAR(255),
                file_type VARCHAR(100),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_user) REFERENCES users(username),
                FOREIGN KEY (to_user) REFERENCES users(username)
            )
        ''')
        
        await conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_messages_users 
            ON messages(from_user, to_user)
        ''')

@app.on_event("shutdown")
async def shutdown():
    if db_pool:
        await db_pool.close()

@app.post("/signup")
async def signup(user: UserSignup):
    async with db_pool.acquire() as conn:
        # Check if user exists
        print(len(user.password.encode('utf-8')))
        print(user.username)
        existing = await conn.fetchrow(
            'SELECT username FROM users WHERE username = $1',
            user.username
        )
        
        if existing:
            raise HTTPException(status_code=400, detail="User already exists")
        
        # Hash password and create user
        await conn.execute(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            user.username, user.password
        )
        
        return {"message": "User created successfully", "username": user.username}

@app.post("/login")
async def login(user: UserLogin):
    async with db_pool.acquire() as conn:
        user_record = await conn.fetchrow(
            'SELECT username, password_hash FROM users WHERE username = $1',
            user.username
        )
        
        if not user_record:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not user.password == user_record['password_hash']:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        return {"message": "Login successful", "username": user.username}

@app.get("/users")
async def get_users(current_user: str):
    async with db_pool.acquire() as conn:
        users = await conn.fetch(
            'SELECT username FROM users WHERE username != $1 ORDER BY username',
            current_user
        )
        
        return {
            "users": [
                {
                    "username": user['username'],
                    "online": user['username'] in active_connections
                }
                for user in users
            ]
        }

@app.get("/messages/{user1}/{user2}")
async def get_messages(user1: str, user2: str):
    async with db_pool.acquire() as conn:
        messages = await conn.fetch('''
            SELECT from_user as "from", to_user as "to", content, 
                   file_data, file_name, file_type, timestamp
            FROM messages
            WHERE (from_user = $1 AND to_user = $2)
               OR (from_user = $2 AND to_user = $1)
            ORDER BY timestamp ASC
        ''', user1, user2)
        
        return {
            "messages": [
                {
                    "from": msg['from'],
                    "to": msg['to'],
                    "content": msg['content'],
                    "file_data": msg['file_data'],
                    "file_name": msg['file_name'],
                    "file_type": msg['file_type'],
                    "timestamp": msg['timestamp'].isoformat()
                }
                for msg in messages
            ]
        }

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    contents = await file.read()
    file_data = base64.b64encode(contents).decode('utf-8')
    return {
        "file_data": file_data,
        "file_name": file.filename,
        "file_type": file.content_type
    }

@app.websocket("/ws/{username}")
async def websocket_endpoint(websocket: WebSocket, username: str):
    await websocket.accept()
    active_connections[username] = websocket
    
    # Notify all users about online status
    await broadcast_user_status(username, True)
    
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            # Save message to database
            async with db_pool.acquire() as conn:
                await conn.execute('''
                    INSERT INTO messages 
                    (from_user, to_user, content, file_data, file_name, file_type)
                    VALUES ($1, $2, $3, $4, $5, $6)
                ''',
                    message_data["from_user"],
                    message_data["to_user"],
                    message_data["content"],
                    message_data.get("file_data"),
                    message_data.get("file_name"),
                    message_data.get("file_type")
                )
            
            msg = {
                "from": message_data["from_user"],
                "to": message_data["to_user"],
                "content": message_data["content"],
                "timestamp": datetime.now().isoformat(),
                "file_data": message_data.get("file_data"),
                "file_name": message_data.get("file_name"),
                "file_type": message_data.get("file_type")
            }
            
            # Send to recipient if online
            recipient = message_data["to_user"]
            if recipient in active_connections:
                await active_connections[recipient].send_text(json.dumps(msg))
            
            # Send back to sender for confirmation
            await websocket.send_text(json.dumps(msg))
            
    except WebSocketDisconnect:
        del active_connections[username]
        await broadcast_user_status(username, False)

async def broadcast_user_status(username: str, online: bool):
    status_msg = {
        "type": "user_status",
        "username": username,
        "online": online
    }
    
    for connection in active_connections.values():
        try:
            await connection.send_text(json.dumps(status_msg))
        except:
            pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)