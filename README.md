# EPSTEIN JETS - AR Racing Game

A production-ready WebXR augmented reality plane racing game with single-player, time trial, and multiplayer modes. Built with Three.js and WebXR for mobile and desktop support.

![Game Preview](https://img.shields.io/badge/WebXR-Enabled-blue) ![Three.js](https://img.shields.io/badge/Three.js-r160-green) ![Status](https://img.shields.io/badge/Status-Production%20Ready-success)

## 🎮 Features

### Game Modes
- **Single Player**: Collect 10 checkpoints and reach the finish line within the time limit
- **Time Trial**: Race 3 laps around the track and beat your best time
- **Multiplayer**: Race against up to 4 players online (WebSocket integration ready)

### Gameplay Features
- ✈️ **5 Unique Planes**: Choose from Fighter, Cruiser, Chopper, Stealth, and Rocket
- 🎯 **Dynamic Checkpoints**: Animated rings with visual feedback
- 🔥 **Boost System**: Tap and hold for speed bursts
- 💥 **Collision Detection**: Players crash on ground impact or mid-air collisions
- 🏁 **Lap Racing**: Complete laps through waypoint gates
- 📱 **Cross-Platform**: Optimized for mobile phones and desktop computers
- 🕹️ **Advanced Controls**: Dual joystick system with keyboard support

### Technical Features
- **WebXR AR Support**: Place planes in real-world environments
- **Advanced Physics**: Gravity, air resistance, and realistic flight dynamics
- **Particle Effects**: Explosions, trails, and visual feedback
- **Shadow Rendering**: Dynamic shadows for enhanced realism
- **Optimized Performance**: 60 FPS on mobile devices
- **Responsive Design**: Adapts to all screen sizes and orientations

## 🚀 Quick Start

### Prerequisites
- Modern web browser with WebXR support (Chrome, Edge, Firefox)
- HTTPS server (required for WebXR)
- Node.js (optional, for local development server)

### Installation

1. **Clone or download this repository**
```bash
git clone https://github.com/yourusername/epstein-jets.git
cd epstein-jets
```

2. **Set up the file structure**
```
epstein-jets/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── main.js
└── assets/
    ├── plane1.glb
    ├── plane2.glb
    ├── plane3.glb
    ├── plane4.glb
    └── plane5.glb
```

3. **Add your plane models**
   - Place 5 different `.glb` plane models in the `assets/` folder
   - Name them: `plane1.glb`, `plane2.glb`, `plane3.glb`, `plane4.glb`, `plane5.glb`
   - Ensure models have the propeller named with "prop" in the name for animation

4. **Serve over HTTPS**

   **Option A: Using Python**
   ```bash
   # Python 3
   python -m http.server 8000 --bind 0.0.0.0
   ```

   **Option B: Using Node.js**
   ```bash
   npx http-server -p 8000 -a 0.0.0.0 -S -C cert.pem -K key.pem
   ```

   **Option C: Using Live Server (VS Code)**
   - Install "Live Server" extension
   - Right-click `index.html` → "Open with Live Server"

5. **Access the game**
   - Desktop: `https://localhost:8000`
   - Mobile: `https://YOUR_IP:8000` (replace YOUR_IP with your computer's local IP)

## 🎮 Controls

### Mobile (Touch)
- **Left Joystick**: Throttle (up/down) and Pitch (up/down)
- **Right Joystick**: Yaw (left/right) and Roll (left/right)
- **Boost Button**: Press and hold for speed boost
- **Reset Button**: Restart the game

### Desktop (Keyboard)
- **W/S or ↑/↓**: Throttle and Pitch
- **A/D or ←/→**: Yaw
- **Q/E**: Roll up/down
- **Space**: Boost
- **R**: Reset

## 🏗️ Architecture

### Core Components

#### `main.js`
- **Player Class**: Manages individual plane physics, rendering, and state
- **Game Logic**: Handles checkpoints, laps, collisions, and win conditions
- **Multiplayer**: WebSocket integration for real-time racing
- **Physics Engine**: Custom physics with gravity and air resistance
- **Particle System**: Explosions and trail effects

#### Key Systems

**Physics System**
```javascript
- Gravity: 9.8 m/s²
- Air Resistance: 0.98 multiplier
- Max Speed: 12 units (20 with boost)
- Collision Detection: Sphere-based with 1.5 unit radius
```

**Checkpoint System**
- Sequential collection in single-player mode
- Gate-based lap system for racing modes
- Visual feedback with color changes and animations

**Multiplayer Architecture**
- WebSocket-based real-time sync
- Room-based matchmaking
- State synchronization every frame
- Crash and finish event broadcasting

## 🎨 Customization

### Adding New Planes

1. Export your plane model as `.glb` format
2. Place it in `assets/` folder (e.g., `plane6.glb`)
3. Update `index.html`:
```html
<div class="planeOption" data-plane="plane6">
    <div class="plane-preview">🛸</div>
    <p>YOUR PLANE NAME</p>
    <span class="plane-stats">Speed: ⭐⭐⭐⭐⭐</span>
</div>
```

### Modifying Game Parameters

Edit `main.js` constants:
```javascript
const GRAVITY = 9.8;              // Gravity strength
const AIR_RESISTANCE = 0.98;      // Air friction
const GROUND_HEIGHT = 0.3;        // Ground collision level
const totalLaps = 3;              // Number of laps in race mode
const totalCheckpoints = 10;      // Checkpoints in single-player
```

### Styling

Edit `style.css` CSS variables:
```css
:root {
    --primary-color: #00d4ff;     /* Main accent color */
    --secondary-color: #ff6600;   /* Boost/fire color */
    --success-color: #00ff88;     /* Checkpoints */
    --danger-color: #ff4444;      /* Crashes */
}
```

## 🌐 Multiplayer Setup

### WebSocket Server

To enable multiplayer, you need a WebSocket server. Here's a basic Node.js example:

```javascript
// server.js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const rooms = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'join') {
            // Add player to room
            if (!rooms.has(data.roomCode)) {
                rooms.set(data.roomCode, new Set());
            }
            rooms.get(data.roomCode).add(ws);
            ws.roomCode = data.roomCode;
        }
        
        // Broadcast to room
        if (ws.roomCode && rooms.has(ws.roomCode)) {
            rooms.get(ws.roomCode).forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        }
    });
});
```

Update `main.js` line ~1080:
```javascript
ws = new WebSocket('wss://your-server-domain.com:8080');
```

## 📱 Mobile Optimization

The game automatically adjusts for mobile devices:
- Reduced particle counts
- Lower shadow quality
- Optimized render distance
- Touch-friendly UI scaling
- Landscape and portrait support

## 🐛 Troubleshooting

### AR Not Working
- Ensure you're using HTTPS
- Check browser WebXR support: `chrome://flags/#webxr`
- Try "Place in Air" mode if floor detection fails
- Update browser to latest version

### Performance Issues
- Reduce `totalCheckpoints` to 5-6
- Lower shadow quality in `setupLighting()`
- Disable trails by commenting out `updateTrail()`
- Use simpler plane models

### Models Not Loading
- Verify `.glb` files are in `assets/` folder
- Check file names match exactly (case-sensitive)
- Open browser console for error messages
- Ensure models are <5MB in size

### Multiplayer Connection Fails
- Set up WebSocket server first
- Update WebSocket URL in code
- Check firewall settings
- Verify server is running

## 📊 Performance Metrics

**Target Performance:**
- Mobile: 60 FPS at 720p
- Desktop: 60 FPS at 1080p
- Memory: <200MB
- Network (MP): <50KB/s per player

**Optimizations:**
- Object pooling for particles
- Frustum culling for checkpoints
- LOD system for distant objects
- Throttled network updates

## 🔒 Security Considerations

For production deployment:
1. Implement rate limiting on WebSocket server
2. Add player authentication
3. Validate all client inputs server-side
4. Use WSS (secure WebSocket)
5. Implement anti-cheat measures
6. Add CORS policies

## 📝 License

This project is provided as-is for educational and commercial use. Customize and deploy as needed.

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- Additional plane models
- New game modes (Battle Royale, Capture the Flag)
- Power-ups and weapons
- Weather effects
- Replay system
- Leaderboards
- Voice chat integration

## 🎯 Roadmap

### Planned Features
- [ ] Server-side physics validation
- [ ] Persistent player profiles
- [ ] Achievement system
- [ ] Customizable plane skins
- [ ] Tournament mode
- [ ] Spectator mode
- [ ] Mobile app wrapper (Cordova/Capacitor)
- [ ] VR headset support

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review browser console for errors
3. Test on different devices/browsers
4. Verify file structure and paths

## 🙏 Acknowledgments

- Three.js team for the amazing 3D library
- WebXR community for AR capabilities
- GLB model creators

---

**Built with ❤️ for immersive AR gaming**

Version: 2.0.0 | Last Updated: January 2026