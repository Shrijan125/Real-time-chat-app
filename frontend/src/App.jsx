import React, { useState, useEffect, useRef } from 'react';
import { Send, Upload, User, LogOut } from 'lucide-react';

const API_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000';

export default function App() {
  const [screen, setScreen] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [ws, setWs] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const savedUser = localStorage.getItem('chatAppUser');
    if (savedUser) {
      setCurrentUser(savedUser);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('chatAppUser', currentUser);
      
      const websocket = new WebSocket(`${WS_URL}/ws/${currentUser}`);
      
      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'user_status') {
          setUsers(prev => prev.map(u => 
            u.username === data.username ? { ...u, online: data.online } : u
          ));
        } else {
          setMessages(prev => {
            const isRelevant = 
              (data.from === currentUser || data.to === currentUser);
            
            if (isRelevant) {
              return [...prev, data];
            }
            return prev;
          });
        }
      };
      
      setWs(websocket);
      
      fetchUsers();
      
      return () => websocket.close();
    }
  }, [currentUser]);

  useEffect(() => {
    if (selectedUser) {
      setNewMessage('');
      fetchMessages(selectedUser.username);
    }
  }, [selectedUser]);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/users?current_user=${currentUser}`);
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const fetchMessages = async (otherUser) => {
    try {
      const res = await fetch(`${API_URL}/messages/${currentUser}/${otherUser}`);
      const data = await res.json();
      setMessages(data.messages);
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  };

  const handleAuth = async (isLogin) => {
    setError('');
    try {
      const endpoint = isLogin ? '/login' : '/signup';
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail);
      }
      
      setCurrentUser(username);
      setUsername('');
      setPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedUser || !ws) return;
    
    const messageData = {
      from_user: currentUser,
      to_user: selectedUser.username,
      content: newMessage
    };
    
    ws.send(JSON.stringify(messageData));
    setNewMessage('');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedUser || !ws) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();
      
      const messageData = {
        from_user: currentUser,
        to_user: selectedUser.username,
        content: `Sent a file: ${file.name}`,
        file_data: data.file_data,
        file_name: data.file_name,
        file_type: data.file_type
      };
      
      ws.send(JSON.stringify(messageData));
    } catch (err) {
      console.error('Error uploading file:', err);
    }
  };

  const handleLogout = () => {
    if (ws) ws.close();
    localStorage.removeItem('chatAppUser');
    setCurrentUser(null);
    setSelectedUser(null);
    setMessages([]);
    setUsers([]);
  };

  const downloadFile = (fileData, fileName) => {
    const linkSource = `data:application/octet-stream;base64,${fileData}`;
    const downloadLink = document.createElement('a');
    downloadLink.href = linkSource;
    downloadLink.download = fileName;
    downloadLink.click();
  };

  const filteredMessages = messages.filter(msg => 
    selectedUser && (
      (msg.from === currentUser && msg.to === selectedUser.username) ||
      (msg.from === selectedUser.username && msg.to === currentUser)
    )
  );

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">
            {screen === 'login' ? 'Login' : 'Sign Up'}
          </h1>
          
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAuth(screen === 'login')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          <button
            onClick={() => handleAuth(screen === 'login')}
            className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 transition mb-4"
          >
            {screen === 'login' ? 'Login' : 'Sign Up'}
          </button>
          
          <p className="text-center text-gray-600">
            {screen === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button
              onClick={() => {
                setScreen(screen === 'login' ? 'signup' : 'login');
                setError('');
              }}
              className="text-blue-500 hover:underline"
            >
              {screen === 'login' ? 'Sign Up' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <User className="w-8 h-8 text-blue-500" />
            <span className="font-semibold text-gray-800">{currentUser}</span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
            title="Logout"
          >
            <LogOut className="w-5 h-5 text-gray-600" />
          </button>
        </div>
        
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-600 uppercase">Users</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {users.map((user) => (
            <div
              key={user.username}
              onClick={() => setSelectedUser(user)}
              className={`p-4 cursor-pointer hover:bg-gray-50 transition flex items-center justify-between ${
                selectedUser?.username === user.username ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center text-white font-semibold">
                  {user.username[0].toUpperCase()}
                </div>
                <span className="font-medium text-gray-800">{user.username}</span>
              </div>
              <div className={`w-3 h-3 rounded-full ${user.online ? 'bg-green-500' : 'bg-gray-300'}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedUser ? (
          <>
            <div className="p-4 bg-white border-b border-gray-200 flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center text-white font-semibold">
                {selectedUser.username[0].toUpperCase()}
              </div>
              <div>
                <h2 className="font-semibold text-gray-800">{selectedUser.username}</h2>
                <p className="text-sm text-gray-500">{selectedUser.online ? 'Online' : 'Offline'}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {filteredMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.from === currentUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      msg.from === currentUser
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
                    <p>{msg.content}</p>
                    {msg.file_name && (
                      <button
                        onClick={() => downloadFile(msg.file_data, msg.file_name)}
                        className="mt-2 text-sm underline hover:no-underline"
                      >
                        Download: {msg.file_name}
                      </button>
                    )}
                    <p className="text-xs mt-1 opacity-70">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-white border-t border-gray-200">
              <div className="flex space-x-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                  title="Upload file"
                >
                  <Upload className="w-5 h-5 text-gray-600" />
                </button>
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSendMessage}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition flex items-center space-x-2"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p className="text-lg">Select a user to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}