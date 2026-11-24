import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 35729 });
wss.on('connection', (socket) => socket.send('reload'));
