const fs = require('fs');
let file = fs.readFileSync('src/screens/HomeScreen.tsx', 'utf8');

if (!file.includes('@expo/vector-icons')) {
  file = file.replace('import React', 'import { Ionicons, MaterialCommunityIcons } from \'@expo/vector-icons\';\nimport React');
}

const replacements = [
  [/<Text style={{ fontSize: 24 }}>📢<\/Text>/g, '<Ionicons name="megaphone-outline" size={24} color="#000" />'],
  [/<Text style={{ fontSize: 40 }}>🚚<\/Text>/g, '<MaterialCommunityIcons name="truck-fast" size={40} color="#000" />'],
  [/<Text style={{ fontSize: 18 }}>📍<\/Text>/g, '<Ionicons name="location-outline" size={18} color="#111827" />'],
  [/<Text style={{ fontSize: 20 }}>📦<\/Text>/g, '<Ionicons name="cube-outline" size={20} color="#111827" />'],
  
  [/📍 /g, ''],
  [/🕒 /g, ''],
  
  [/<Text style={{ fontSize: 18, color: '#451A03', marginRight: 8 }}>▶<\/Text>/g, '<Ionicons name="play" size={18} color="#451A03" style={{ marginRight: 8 }} />'],
  [/<Text style={{ fontSize: 24, marginRight: 8 }}>🧭<\/Text>/g, '<Ionicons name="compass-outline" size={24} color="#CA8A04" style={{ marginRight: 8 }} />'],
  [/<Text style={{ fontSize: 24, marginRight: 8 }}>{isPickup \? '📦' : '📋'}<\/Text>/g, '{isPickup ? <Ionicons name="cube-outline" size={24} color="#CA8A04" style={{ marginRight: 8 }} /> : <Ionicons name="clipboard-outline" size={24} color="#1D4ED8" style={{ marginRight: 8 }} />}'],
  [/<Text style={{ fontSize: 24, marginRight: 8 }}>📦<\/Text>/g, '<Ionicons name="cube-outline" size={24} color="#EA580C" style={{ marginRight: 8 }} />'],
  [/<Text style={{ fontSize: 24, marginRight: 8 }}>⚠️<\/Text>/g, '<Ionicons name="warning-outline" size={24} color="#DC2626" style={{ marginRight: 8 }} />'],
  [/<Text style={{ fontSize: 24, marginRight: 8 }}>☕<\/Text>/g, '<Ionicons name="cafe-outline" size={24} color="#6D28D9" style={{ marginRight: 8 }} />'],
  [/<Text style={{ fontSize: 24, marginRight: 8 }}>🆘<\/Text>/g, '<MaterialCommunityIcons name="car-emergency" size={24} color="#DC2626" style={{ marginRight: 8 }} />'],
  
  [/<Text style={{ fontSize: 64, marginBottom: 16 }}>✅<\/Text>/g, '<Ionicons name="checkmark-circle" size={64} color="#27A150" style={{ marginBottom: 16 }} />'],
  [/<Text style={{ fontSize: 32, opacity: 0\.5 }}>⏳<\/Text>/g, '<Ionicons name="hourglass-outline" size={32} color="#6B7280" style={{ opacity: 0.5 }} />'],
  
  [/<Text style={{ fontSize: 28 }}>{pendingRoute \? '🚛' : '📍'}<\/Text>/g, '{pendingRoute ? <MaterialCommunityIcons name="truck-delivery" size={28} color="#000" /> : <Ionicons name="location-outline" size={28} color="#000" />}'],
  
  [/🚨 /g, ''],
  [/⬇️/g, ''],
  
  [/<Text style={{ fontSize: 40 }}>👨🏽<\/Text>/g, '<Ionicons name="person-circle-outline" size={40} color="#9CA3AF" />'],
  [/<Text style={{ fontSize: 16 }}>✏️<\/Text>/g, '<Ionicons name="pencil" size={16} color="#451A03" />'],
  
  [/<Text style={{ fontSize: 24, color: '#451A03' }}>≡<\/Text>/g, '<Ionicons name="menu" size={24} color="#451A03" />'],
  [/<Text style={{ fontSize: 20 }}>👨🏽<\/Text>/g, '<Ionicons name="person-circle-outline" size={20} color="#9CA3AF" />'],
  
  [/ 👋/g, ''],
  [/<Text style={{ fontSize: 18 }}>🔔<\/Text>/g, '<Ionicons name="notifications-outline" size={18} color="#111827" />'],
  
  [/<Text style={{ fontSize: 24, opacity: activeTab === 'route' \? 1 : 0\.5 }}>🏠<\/Text>/g, '<Ionicons name="home" size={24} color={activeTab === \'route\' ? \'#CA8A04\' : \'#6B7280\'} />'],
  [/<Text style={{ fontSize: 24, opacity: activeTab === 'wallet' \? 1 : 0\.5 }}>🚚<\/Text>/g, '<MaterialCommunityIcons name="truck-outline" size={24} color={activeTab === \'wallet\' ? \'#CA8A04\' : \'#6B7280\'} />'],
  [/<Text style={{ fontSize: 28, color: '#451A03' }}>📷<\/Text>/g, '<Ionicons name="camera-outline" size={28} color="#451A03" />'],
  [/<Text style={{ fontSize: 24, opacity: 0\.5 }}>💬<\/Text>/g, '<Ionicons name="chatbubble-outline" size={24} color="#6B7280" />'],
  [/<Text style={{ fontSize: 24, opacity: activeTab === 'profile' \? 1 : 0\.5 }}>👤<\/Text>/g, '<Ionicons name="person-outline" size={24} color={activeTab === \'profile\' ? \'#CA8A04\' : \'#6B7280\'} />'],
  
  [/<Text style={{ fontSize: 32 }}>🎧<\/Text>/g, '<Ionicons name="headset-outline" size={32} color="#000" />'],
  [/<Text style={{ color: 'white', fontSize: 28, transform: \[\{ rotate: '135deg' \}\] }}>📞<\/Text>/g, '<Ionicons name="call" size={28} color="white" style={{ transform: [{ rotate: \'135deg\' }] }} />'],
  [/<Text style={{ color: 'white', fontSize: 28 }}>📞<\/Text>/g, '<Ionicons name="call" size={28} color="white" />'],
  [/🔄 /g, ''],
  [/✔/g, '']
];

replacements.forEach(([regex, repl]) => {
  file = file.replace(regex, repl);
});

fs.writeFileSync('src/screens/HomeScreen.tsx', file);
console.log("Emojis replaced successfully");
